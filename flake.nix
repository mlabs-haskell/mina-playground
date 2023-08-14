{
  description = "mina-playground";
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs";
    flake-utils.url = "github:numtide/flake-utils";
    gitignore = {
      url = "github:hercules-ci/gitignore.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
  outputs = {
    nixpkgs,
    flake-utils,
    gitignore,
    ...
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {inherit system;};
      nodeMajorVersion = 18;
      nodejs = pkgs."nodejs-${builtins.toString nodeMajorVersion}_x";
      node2nixOutput = import ./nix {inherit pkgs nodejs system;};
      nodeDeps = node2nixOutput.nodeDependencies;
      zkAgora = pkgs.stdenv.mkDerivation {
        name = "mina-playground";
        version = "0.1.0";
        src = gitignore.lib.gitignoreSource ./.;
        buildInputs = [nodejs];
        buildPhase = ''
          runHook preBuild
          ln -sf ${nodeDeps}/lib/node_modules ./node_modules
          export PATH="${nodeDeps}/bin:$PATH"
          npm run build
          runHook postBuild
        '';
        installPhase = ''
          runHook preInstall
          mkdir -p $out
          cp package.json $out/package.json
          cp -r dist $out/dist
          ln -sf ${nodeDeps}/lib/node_modules $out/node_modules
          runHook postInstall
        '';
      };
      runNode2Nix = pkgs.writeShellScriptBin "runNode2Nix" ''
        ${pkgs.node2nix}/bin/node2nix \
        -${builtins.toString nodeMajorVersion} \
        --input package.json \
        --lock package-lock.json \
        --node-env ./nix/node-env.nix \
        --composition ./nix/default.nix \
        --output ./nix/node-package.nix \
        --development
      '';
      runZkAgoraCli = name: pkgs.writeShellScriptBin name ''
        ${nodejs}/bin/node \
        --experimental-vm-modules \
        --experimental-wasm-threads \
        --experimental-wasm-modules \
        --es-module-specifier-resolution=node \
        --no-warnings \
        ${zkAgora}/dist/bin/${name}.js $@
      '';
    in {
      packages = {
        inherit zkAgora;
        default = zkAgora;
      };
      devShells = {
        default = pkgs.mkShell {
          buildInputs = [
            nodejs
            runNode2Nix
          ];
        };
        demo = pkgs.mkShell {
          buildInputs = [
            (runZkAgoraCli "cli")
            (runZkAgoraCli "deploy")
            (runZkAgoraCli "genkey")
          ];
          NODE_PATH = "${nodeDeps}/lib/node_modules";
        };
      };
    });
}
