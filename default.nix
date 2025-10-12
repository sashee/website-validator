let
	dependencies = import ./dependencies.nix {
		packageJson = ./package.json;
		packageLockJson = ./package-lock.json;
	};

	pkgs = dependencies.pkgs;

	node_modules = (import ./node_modules.nix {
		pkgs = pkgs;
		packageJson = ./package.json;
		packageLockJson = ./package-lock.json;
	}).node_modules;

	builder = (import ./builder.nix {
		pkgs = pkgs;
		node_modules = node_modules;
	});

	packageJson = pkgs.lib.importJSON ./package.json;

	runInLandRun =''
		${pkgs.landrun}/bin/landrun \
			--rox /usr,/dev,/nix \
			--rwx ${builtins.toString ./.} \
			--rwx $TMPDIR \
			--rwx /dev/null \
			--rwx /dev/random \
			--env PATH \
			--env HOME \
			--env TMPDIR \
			--bind-tcp 8080 \
			--bind-tcp 9229 \
	'';

	code = pkgs.stdenv.mkDerivation ({
		pname = packageJson.name;
		version = packageJson.version;
		outputs = ["out"];
		src = builder.src;
		buildInputs = [pkgs.nodePackages_latest.nodejs];
		buildPhase = ''
			mkdir $out
			cp -r ${builder.builder}/. $out
			cp ${builder.builder}/package.json $out/_package.json
			cp ${builder.builder}/package-lock.json $out/_package-lock.json
			cd $out
			npm run build
			NODE_DEBUG="website-validator*" CACHE_DIR=$out/.cache npm run test
		'';
		shellHook = ''
			${runInLandRun} ln -fs ${builder.builder}/node_modules node_modules
			${runInLandRun} ${pkgs.bash}/bin/bash
			exit
		'';
		LANDRUN_LOG_LEVEL = "debug";
		dontInstall = true;
		dontFixup = true;
		dontPatchShebangs = true;
	} // dependencies.variables);

	package = pkgs.stdenv.mkDerivation {
		name = "package";
		outputs = ["out"];
		src = code;
		buildInputs = [pkgs.nodePackages_latest.nodejs];
		buildPhase = ''
			mkdir $out
			cd $src
			NPM_CONFIG_CACHE=$out/.npm_cache CACHE_DIR=$out/.cache npm pack --pack-destination $out
		'';
		dontInstall = true;
		dontFixup = true;
		dontPatchShebangs = true;
	};
in {
	code = code;
	package = package;
}
