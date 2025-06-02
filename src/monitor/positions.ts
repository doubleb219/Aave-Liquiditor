import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// Minimum ABI required to query the Aave Pool
const AAVE_POOL_ABI = [
    "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
    "function getReservesList() view returns (address[])",
    "function getReserveData(address asset) view returns (tuple(uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp) data)",
    "function getConfiguration(address asset) view returns (tuple(uint256 data) config)",
    "function getUserConfiguration(address user) view returns (tuple(uint256 data) config)"
];

// Interface for configuring reservations
interface ReserveConfig {
    ltv: number;
    liquidationThreshold: number;
    liquidationBonus: number;
    decimals: number;
    reserveFactor: number;
    usageAsCollateralEnabled: boolean;
    borrowingEnabled: boolean;
    stableBorrowRateEnabled: boolean;
    isActive: boolean;
    isFrozen: boolean;
}

interface Position {
    user: string;
    healthFactor: number;
    totalCollateralETH: number;
    totalDebtETH: number;
    estimatedProfit: number;
    collateralAsset?: string;
    liquidationBonus?: number;
}

export class PositionMonitor {
    private provider: ethers.JsonRpcProvider;
    private pool: ethers.Contract;
    private minHealthFactor: number;
    private minProfitUSD: number;
    private addressesCache: Set<string>;
    private lastUpdate: number;
    private reservesList: string[] | null;

    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL);
        this.pool = new ethers.Contract(
            process.env.AAVE_LENDING_POOL || '',
            AAVE_POOL_ABI,
            this.provider
        );
        this.minHealthFactor = parseFloat(process.env.MIN_HEALTH_FACTOR || '1.1');
        this.minProfitUSD = parseFloat(process.env.MIN_PROFIT_USD || '100');
        this.addressesCache = new Set<string>();
        this.lastUpdate = 0;
        this.reservesList = null;
    }

    private async getAddressesFromArbiscan(): Promise<string[]> {
        try {
            // Only update every 5 minutes
            const now = Date.now();
            if (now - this.lastUpdate < 5 * 60 * 1000 && this.addressesCache.size > 0) {
                return Array.from(this.addressesCache);
            }

            const apiKey = process.env.ARBISCAN_API_KEY;
            if (!apiKey) {
                console.error('❌ ARBISCAN_API_KEY no configured');
                return Array.from(this.addressesCache);
            }

            // Get the last 10,000 transactions from the Aave contract
            const response = await axios.get(`https://api.arbiscan.io/api`, {
                params: {
                    module: 'account',
                    action: 'txlist',
                    address: process.env.AAVE_LENDING_POOL,
                    startblock: 0,
                    endblock: 99999999,
                    page: 1,
                    offset: 10000,
                    sort: 'desc',
                    apikey: apiKey
                }
            });

            if (response.data.status === '1' && response.data.result) {
                // Extract unique addresses from transactions
                const addresses = new Set<string>();
                for (const tx of response.data.result) {
                    addresses.add(tx.from.toLowerCase());
                }

                this.addressesCache = addresses;
                this.lastUpdate = now;

                console.log(`📊 Found ${addresses.size} unique addresses interacting with Aave`);
                return Array.from(addresses);
            }

            return Array.from(this.addressesCache);
        } catch (error) {
            console.error('Error getting addresses from Arbiscan:', error);
            return Array.from(this.addressesCache);
        }
    }

    private async getReservesList(): Promise<string[]> {
        if (!this.reservesList) {
            this.reservesList = await this.pool.getReservesList();
        }
        return this.reservesList || [];
    }

    private async getUserCollateral(user: string): Promise<string | null> {
        const reserves = await this.getReservesList();
        const { data } = await this.pool.getUserConfiguration(user);
        const config = BigInt(data.toString());

        // Iterate over the reserves to find the active collateral
        for (let i = 0; i < reserves.length; i++) {
            const isUsedAsCollateral = Boolean((config >> BigInt(i * 2)) & 1n);
            if (isUsedAsCollateral) {
                return reserves[i];
            }
        }

        return null;
    }

    private async getReserveConfig(asset: string): Promise<ReserveConfig> {
        const { data } = await this.pool.getConfiguration(asset);
        const config = BigInt(data.toString());

        return {
            ltv: Number((config >> 0n) & 0xFFFFn) / 100,
            liquidationThreshold: Number((config >> 16n) & 0xFFFFn) / 100,
            liquidationBonus: Number((config >> 32n) & 0xFFFFn) / 100,
            decimals: Number((config >> 48n) & 0xFFn),
            reserveFactor: Number((config >> 64n) & 0xFFFFn) / 100,
            usageAsCollateralEnabled: Boolean((config >> 80n) & 1n),
            borrowingEnabled: Boolean((config >> 81n) & 1n),
            stableBorrowRateEnabled: Boolean((config >> 82n) & 1n),
            isActive: Boolean((config >> 83n) & 1n),
            isFrozen: Boolean((config >> 84n) & 1n)
        };
    }

    async findLiquidatablePositions(): Promise<Position[]> {
        try {
            const addresses = await this.getAddressesFromArbiscan();
            const positions: Position[] = [];

            console.log(`🔍 Analyzing ${addresses.length} addresses...`);
            let checked = 0;

            for (const user of addresses) {
                try {
                    const {
                        totalCollateralBase,
                        totalDebtBase,
                        healthFactor
                    } = await this.pool.getUserAccountData(user);

                    const healthFactorNumber = parseFloat(ethers.formatUnits(healthFactor, 18));

                    if (healthFactorNumber >= this.minHealthFactor) continue;

                    const totalCollateralETH = parseFloat(ethers.formatUnits(totalCollateralBase, 18));
                    const totalDebtETH = parseFloat(ethers.formatUnits(totalDebtBase, 18));

                    // Obtain the asset used as collateral
                    const collateralAsset = await this.getUserCollateral(user);
                    if (!collateralAsset) continue;

                    // Get booking settings
                    const reserveConfig = await this.getReserveConfig(collateralAsset);
                    const liquidationBonus = reserveConfig.liquidationBonus / 100; // Convert from percentage to decimal

                    // Calculate potential profit
                    const maxLiquidation = totalDebtETH * 0.5; // Maximum 50% of the debt
                    const estimatedProfit = (maxLiquidation * liquidationBonus) -
                        (maxLiquidation * 0.001); // 0.1% fee por flash loan

                    // Convert to USD using the approximate ETH price
                    const ethPriceUSD = 2200; // ALL: Get real price
                    const estimatedProfitUSD = estimatedProfit * ethPriceUSD;

                    if (estimatedProfitUSD < this.minProfitUSD) continue;

                    positions.push({
                        user,
                        healthFactor: healthFactorNumber,
                        totalCollateralETH,
                        totalDebtETH,
                        estimatedProfit: estimatedProfitUSD,
                        collateralAsset,
                        liquidationBonus: liquidationBonus * 100 // Convert to percentage to display
                    });

                    checked++;
                    if (checked % 100 === 0) {
                        console.log(`✓ Analyzed ${checked}/${addresses.length} addresses`);
                    }
                } catch (error) {
                    // Ignore individual errors and continue with the next address
                    continue;
                }
            }

            return positions.sort((a, b) => b.estimatedProfit - a.estimatedProfit);
        } catch (error) {
            console.error('Error searching for positions:', error);
            return [];
        }
    }

    async startMonitoring(interval: number = 60000) {
        console.log('🚀 Starting position monitoring...');

        const checkPositions = async () => {
            const positions = await this.findLiquidatablePositions();

            if (positions.length > 0) {
                console.log(`\n✅ Found ${positions.length} liquidable positions:`);
                positions.forEach(pos => {
                    console.log(`
                        👤 User: ${pos.user}
                        ❤️ Health Factor: ${pos.healthFactor}
                        💰 Estimated profit: $${pos.estimatedProfit.toFixed(2)}
                        🏦 Total Cholesterol: ${pos.totalCollateralETH.toFixed(4)} ETH
                        💸 Total Debt: ${pos.totalDebtETH.toFixed(4)} ETH
                    `);
                });
            } else {
                console.log('\n❌ No liquidable positions were found');
            }
        };

        // First immediate execution
        await checkPositions();

        // Set the interval 
        setInterval(checkPositions, interval);
    }
} 