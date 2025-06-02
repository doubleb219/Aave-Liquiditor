import { PositionMonitor } from '../src/monitor/positions';

async function main() {
    const monitor = new PositionMonitor();

    console.log('🔍 Starting position monitoring on Aave v3 (Arbitrum)...');
    console.log('⚙️ Configuration:');
    console.log(`   Min Health Factor: ${process.env.MIN_HEALTH_FACTOR || '1.1'}`);
    console.log(`   Min Profit USD: $${process.env.MIN_PROFIT_USD || '100'}`);

    const positions = await monitor.findLiquidatablePositions();

    if (positions.length > 0) {
        console.log(`\n✅ Found ${positions.length} liquidable positions:`);
        positions.forEach(pos => {
            console.log(`
            👤 User: ${pos.user}
            ❤️ Health Factor: ${pos.healthFactor.toFixed(4)}
            💰 Estimated profit: $${pos.estimatedProfit.toFixed(2)}
            🏦 Total Cholesterol: ${pos.totalCollateralETH.toFixed(4)} ETH
            💸 Total Debt: ${pos.totalDebtETH.toFixed(4)} ETH
            🪙 Asset Collateral: ${pos.collateralAsset}
            🎁 Bonus Liquidation: ${pos.liquidationBonus?.toFixed(2)}%
            `);
        });
    } else {
        console.log('\n❌ No liquidable positions were found');
    }
}

main().catch(error => {
    console.error('Error in the script:', error);
    process.exit(1);
}); 