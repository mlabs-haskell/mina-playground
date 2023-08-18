import { command, option, string, run, restPositionals, flag } from "cmd-ts";
import { Account, Mina, PrivateKey } from "snarkyjs";
import fs from 'fs/promises';

await run(command({
  name: "genkey",
  args: {
    fundAccounts: flag({
      long: "fund-accounts"
    }),
    outputs: restPositionals({
      type: string
    })
  },
  handler: async (args) => {
    for (const output of args.outputs) {
      console.log("generating...");

      const privateKey = PrivateKey.random();
      const publicKey = privateKey.toPublicKey();

      if (args.fundAccounts) {
        console.log("requesting funds...");
        await Mina.faucet(publicKey);
      }

      const keyPair = {
        privateKey: privateKey.toBase58(),
        publicKey: publicKey.toBase58()
      };

      await fs.writeFile(output, JSON.stringify(keyPair));

      console.log("done");
    };
  }
}), process.argv.slice(2));

process.exit(0);