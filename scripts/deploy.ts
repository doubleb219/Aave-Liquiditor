import { ethers } from "hardhat";

async function main() {
  console.log("🚀 Starting FlashLiquidator contract deployment...");

  // Aave v3 Pool Addresses Provider address on Arbitrum
  const AAVE_POOL_ADDRESSES_PROVIDER = "0x0C1Bdb8fc6FaC25c762C434858aC00a7C2e9Cc64";

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