const { expect } = require("chai");
const { Contract } = require("ethers");
const { ethers,hre } = require("hardhat");


async function sendEth(send_account, to_address, send_token_amount) {
    const nonce = await ethers.provider.getTransactionCount(send_account, "latest");
    const gas_price = await ethers.provider.getGasPrice();
    
    const tx = {
      from: send_account,
      to: to_address,
      value: send_token_amount,
      nonce: nonce,
      gasLimit: 100000, // 100000
      gasPrice: gas_price,
    }
    const signer = ethers.provider.getSigner(send_account);
    await signer.sendTransaction(tx);

}

async function getTokenTransferData(to_address, send_token_amount, erc20) {
    const iface = erc20.interface;
    return iface.encodeFunctionData("transfer", [to_address, send_token_amount]);
}

describe("Outbox", async function () {
    let outboxWithOpt;
    let outboxWithoutOpt;
    let token;
    before(async function () {
        const OutboxWithOpt = await ethers.getContractFactory("OutboxWithOpt");
        const OutboxWithoutOpt = await ethers.getContractFactory("OutboxWithoutOpt");
        const Token = await ethers.getContractFactory("TestToken");
        token = await Token.deploy("Test token", "tst");
        outboxWithOpt = await OutboxWithOpt.deploy();
        outboxWithoutOpt = await OutboxWithoutOpt.deploy();
        // await outboxWithOpt.deployed();
        // await outboxWithoutOpt.deployed();
        const balance = await token.balanceOf("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
        console.log("balance of this token:" + balance);
        await outboxWithOpt.initialize("0x95F2e4096482Ebaded815b3aAcFA1524EF3E0568","0x95F2e4096482Ebaded815b3aAcFA1524EF3E0568");
        await outboxWithoutOpt.initialize("0x95F2e4096482Ebaded815b3aAcFA1524EF3E0568","0x95F2e4096482Ebaded815b3aAcFA1524EF3E0568");
    })
    it("First call to initial some storage", async function () {    
        expect(await outboxWithOpt.executeTransaction("1",["0x5fd1d356f1e53db956eec1c68a4fb02585a3b7a1d78dfbf1f4d0fad9060422d5"],"1","0x5B38Da6a701c568545dCfcB03FcB875f56beddC4","0x5B38Da6a701c568545dCfcB03FcB875f56beddC4","100","100","1643814360","0","0x")).to.emit("BridgeCallTriggered")
        expect(await outboxWithoutOpt.executeTransaction("1",["0x5fd1d356f1e53db956eec1c68a4fb02585a3b7a1d78dfbf1f4d0fad9060422d5"],"1","0x5B38Da6a701c568545dCfcB03FcB875f56beddC4","0x5B38Da6a701c568545dCfcB03FcB875f56beddC4","100","100","1643814360","0","0x")).to.emit("BridgeCallTriggered")
        
    });
    
    it("Call twice without storage initail cost", async function () {
        expect(await outboxWithOpt.executeTransaction("1",["0x5fd1d356f1e53db956eec1c68a4fb02585a3b7a1d78dfbf1f4d0fad9060422d5"],"1","0x5B38Da6a701c568545dCfcB03FcB875f56beddC4","0x5B38Da6a701c568545dCfcB03FcB875f56beddC4","100","100","1643814360","0","0x")).to.emit("BridgeCallTriggered")
        expect(await outboxWithoutOpt.executeTransaction("1",["0x5fd1d356f1e53db956eec1c68a4fb02585a3b7a1d78dfbf1f4d0fad9060422d5"],"1","0x5B38Da6a701c568545dCfcB03FcB875f56beddC4","0x5B38Da6a701c568545dCfcB03FcB875f56beddC4","100","100","1643814360","0","0x")).to.emit("BridgeCallTriggered")
        
    });

    it("call to send eth", async function() {
        const accounts = await ethers.getSigners();
        const sentEthAmount = ethers.utils.parseEther("1");
        
        const destAddress = "0x760723CD2e632826c38Fef8CD438A4CC7E7E1A40";
        await sendEth(accounts[0].address, outboxWithOpt.address, sentEthAmount);
        await sendEth(accounts[0].address, outboxWithoutOpt.address, sentEthAmount);
        const testBytes = ethers.utils.keccak256("0x");
        // //await OutboxWithoutOptInitailTx.wait();
        await outboxWithOpt.executeTransaction("1",[testBytes],"1",accounts[0].address,destAddress,"100","100","1643814360", sentEthAmount,"0x")
        await outboxWithoutOpt.executeTransaction("1",[testBytes],"1",accounts[0].address,destAddress,"100","100","1643814360", sentEthAmount,"0x")
        const balance = await ethers.provider.getBalance(destAddress);
        const shouldReceivedAmount = await sentEthAmount.mul(2).toString();
        expect(balance).equals(shouldReceivedAmount)
    })

    it("call to send token", async function() {
        const accounts = await ethers.getSigners();
        const sentTokenAmount = ethers.utils.parseEther("1");
        await token.mint(accounts[0].address, ethers.utils.parseEther("100"))
        const destAddress = "0x760723CD2e632826c38Fef8CD438A4CC7E7E1A40";
        await token.transfer(outboxWithOpt.address, sentTokenAmount);
        await token.transfer(outboxWithoutOpt.address, sentTokenAmount);
        console.log("here")
        const balance1 = await token.balanceOf(outboxWithOpt.address);
        console.log(balance1)
        const testBytes = ethers.utils.keccak256("0x");
        const txData = await getTokenTransferData(destAddress, sentTokenAmount, token);
        console.log(txData);
        // //await OutboxWithoutOptInitailTx.wait();
        await outboxWithOpt.executeTransaction("1",[testBytes],"1",accounts[0].address, token.address,"100","100","1643814360", 0, txData)
        await outboxWithoutOpt.executeTransaction("1",[testBytes],"1",accounts[0].address, token.address,"100","100","1643814360", 0, txData)
        const balance = await token.balanceOf(destAddress);
        const shouldReceivedAmount = await sentTokenAmount.mul(2).toString();
        expect(balance).equals(shouldReceivedAmount)
    })
    
  });
  