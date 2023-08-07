import { AccountUpdate, CircuitValue, Field, Mina, Poseidon, PrivateKey, PublicKey, Struct, UInt32, UInt64, prop } from "snarkyjs";
import { GovernanceParameters, Governor } from "./Prototype";
import { Dummy } from "./Dummy";

let proofsEnabled = false;

class A extends Struct({a: UInt64}){
  getHash() { return Poseidon.hash(this.a.toFields()); }
}

class B extends CircuitValue{
  @prop a: UInt64
  getHash() { return Poseidon.hash(this.a.toFields()); }
}

describe('it works', () => {
  let deployerPrivateKey: PrivateKey
  let deployerPublicKey: PublicKey

  let governorPrivateKey: PrivateKey
  let governorPublicKey: PublicKey

  let dummyPrivateKey: PrivateKey
  let dummyPublicKey: PublicKey

  let governor: Governor
  let dummy: Dummy

  // const governanceParameters = new GovernanceParameters(
  //   100, 100_000
  // );

  const mintGovernanceTokens = async () => {
    const txn = await Mina.transaction(deployerPublicKey, () => {
      AccountUpdate.fundNewAccount(deployerPublicKey);
      dummy.deploy();
      dummy.mintNewTokens(deployerPublicKey);
    });
    await txn.prove();
    await txn.sign([deployerPrivateKey, dummyPrivateKey]).send();
  }

  beforeAll(async () => {
    const Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);

    deployerPrivateKey = Local.testAccounts[0].privateKey;
    deployerPublicKey = Local.testAccounts[0].publicKey;

    governorPrivateKey = PrivateKey.random();
    governorPublicKey = governorPrivateKey.toPublicKey();

    dummyPrivateKey = PrivateKey.random();
    dummyPublicKey = dummyPrivateKey.toPublicKey();

    if (proofsEnabled) {
      Governor.compile();
      Dummy.compile();
    }

    dummy = new Dummy(deployerPublicKey);

    await mintGovernanceTokens();
    // governor = new Governor(governanceParameters, governorPublicKey, dummy.token.id);
  });

  it("deploy governor", async () => {
    const a = new A({a: new UInt64(0)});
    const h = a.getHash()
    console.log(h.toString());
    // const txn = await Mina.transaction(governorPublicKey, () => {
    //   AccountUpdate.fundNewAccount(governorPublicKey);
    //   governor.deploy();
    // });
    // await txn.prove();
    // await txn.sign([deployerPrivateKey, governorPrivateKey]).send();

  });



  // it("spawn an instance of B from a method of A", async () => {
  //   const instanceOfA = new A(contractPublicKey);
  //   const instanceOfB = await spawnB(instanceOfA, deployerKey);
  //   instanceOfB.num.get().assertEquals(Field(4242));
  // });
});