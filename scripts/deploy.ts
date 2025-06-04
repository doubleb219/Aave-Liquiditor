import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Starting FlashLiquidator contract deployment...");

  // Aave v3 Pool Addresses Provider address on Arbitrum
  const AAVE_POOL_ADDRESSES_PROVIDER = "0x012bAC54348C0E635dCAc9D5FB99f06F24136C9A";

  const FlashLiquidator = await ethers.getContractFactory("FlashLiquidator");
  const flashLiquidator = await FlashLiquidator.deploy(AAVE_POOL_ADDRESSES_PROVIDER);

  await flashLiquidator.waitForDeployment();

  console.log(
    `✅ FlashLiquidator deployed in: ${await flashLiquidator.getAddress()}`
  );
}

main().catch((error) => {
  console.error("❌ Deployment error:", error);
  process.exitCode = 1;
}); 