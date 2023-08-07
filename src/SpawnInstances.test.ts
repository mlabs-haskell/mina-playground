import { Field, Mina, PrivateKey, PublicKey } from "snarkyjs";
import { A, spawnA, spawnB } from "./SpawnInstances";

let proofsEnabled = false;

describe('it works', () => {
  let deployerKey: PrivateKey
  let contractPrivateKey: PrivateKey
  let contractPublicKey: PublicKey

  beforeAll(() => {
    const Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);

    deployerKey = Local.testAccounts[0].privateKey;
    contractPrivateKey = PrivateKey.random();
    contractPublicKey = contractPrivateKey.toPublicKey();
  });

  it("spawn an instance of A", async () => {
    await spawnA(contractPrivateKey, deployerKey);
  });

  it("spawn an instance of B from a method of A", async () => {
    const instanceOfA = new A(contractPublicKey);
    const instanceOfB = await spawnB(instanceOfA, deployerKey);
    instanceOfB.num.get().assertEquals(Field(4242));
  });
});