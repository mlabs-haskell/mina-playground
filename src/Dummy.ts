import { PublicKey, SmartContract, method } from "snarkyjs";

export class Dummy extends SmartContract {
  @method mintNewTokens(receiverAddress: PublicKey) {
    this.token.mint({
      address: receiverAddress,
      amount: 100_000_000_000,
    });
  }
}