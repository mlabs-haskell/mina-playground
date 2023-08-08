{
  inputs.nixpkgs.url = "nixpkgs";

  outputs = {nixpkgs, ...}: 
  let system = "x86_64-linux";
      pkgs = import nixpkgs {inherit system;}; in 
      {
        devShells.${system}.default = pkgs.mkShell {
          packages = [pkgs.nodejs_18];
        };
      };
}
