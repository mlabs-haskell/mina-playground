import { Account, AccountUpdate, PrivateKey } from "snarkyjs";
import { Env } from "./Env";

// TODO: don't hardcode this.
const configFile = "./config.json";

function safeRandomPrivateKey(): PrivateKey {
  const privateKey = PrivateKey.random();
  const publicKey = privateKey.toPublicKey();
  const account = Account(publicKey);

  if (account.isNew.get().toBoolean())
    return privateKey;
  return safeRandomPrivateKey();
}

await Env.withEnv(
  async (env) => {
    const governorPrivateKey = safeRandomPrivateKey();
    const governorPublicKey = governorPrivateKey.toPublicKey();

    env.governorPublicKey = governorPublicKey;

    await env.submitTx(
      () => {
        AccountUpdate.fundNewAccount(env.userPublicKey);
        env.governor.deployGovernor(env.governanceParameters);
      },
      // The deployer should sign.
      true,
      [governorPrivateKey]);

    console.log("governor public key", governorPublicKey.toBase58());
  }
  , configFile
  // Create empty storage.
  , true
  // Write the public key governor back to the config file.
  , true
);

process.exit(0);