import { ethers } from 'ethers';
import { PositionMonitor } from './monitor/positions';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        // Configure provider and wallet
        const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC_URL);
        const wallet = new ethers.Wallet(process.env.PRIVATE_KEY || '', provider);

        console.log('🚀 Starting Aave v3 liquidation bot');
        console.log('Bot address:', wallet.address);

        // Start position monitor
        const monitor = new PositionMonitor();

        // Start monitoring every 1 minute
        await monitor.startMonitoring(60000);

    } catch (error) {
        console.error('Error en el bot:', error);
        process.exit(1);
    }
}

main(); 