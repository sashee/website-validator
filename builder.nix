{
  pkgs,
	node_modules
}:

let
	packageJson = pkgs.lib.importJSON ./package.json;

	srcWithoutNix = (pkgs.lib.sources.cleanSourceWith {
		filter=(name: type: !(builtins.any (test: test name) (builtins.map (suffix: (name: pkgs.lib.strings.hasSuffix suffix name)) [".nix"])));
		src=pkgs.nix-gitignore.gitignoreSource [] ./.;
	});

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
	src = srcWithoutNix;
}

