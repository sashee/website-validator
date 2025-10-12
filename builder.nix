{
  pkgs,
	node_modules
}:

let
	packageJson = pkgs.lib.importJSON ./package.json;

	builder = pkgs.stdenv.mkDerivation {
		pname = ''${packageJson.name}-builder'';
		version = packageJson.version;
		src = pkgs.nix-gitignore.gitignoreSource [] ./.;
		installPhase = ''
			mkdir $out
			cp -r $src/. $out
			chmod -R a+w $out/src
			ln -s ${node_modules} $out/node_modules
		'';
		dontBuild = true;
		dontFixup = true;
		dontPatchShebangs = true;
	};

in {
	builder = builder;
	src = pkgs.nix-gitignore.gitignoreSource [] ./.;
}

