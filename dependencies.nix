let
  nixpkgs = fetchTarball "https://github.com/NixOS/nixpkgs/tarball/nixos-25.05";
  pkgs = import nixpkgs { config = {}; overlays = []; };

	node_modules = (import ./node_modules.nix {
		pkgs = pkgs;
	}).node_modules;

	vnu_jar = ''${node_modules}/vnu-jar/build/dist/vnu.jar'';

	vnu_jsa = pkgs.runCommand "vnu_jsa" {} ''
mkdir -p $out

${pkgs.jdk24}/bin/java -XX:AOTMode=record -XX:AOTConfiguration=$out/app.aotconf -jar ${vnu_jar} --help
${pkgs.jdk24}/bin/java -XX:AOTMode=create -XX:AOTConfiguration=$out/app.aotconf -XX:AOTCache=$out/app.aot -jar ${vnu_jar} --help
		'';
	vnu = pkgs.writeShellScriptBin "vnu" ''
${pkgs.jdk24}/bin/java -XX:AOTCache=${vnu_jsa}/app.aot -XX:AOTMode=on -jar ${vnu_jar} "$@"
	'';

	epubcheck_jar = ''${node_modules}/epubcheck-static/vendor/epubcheck.jar'';

	epubcheck_jsa = pkgs.runCommand "epubcheck_jsa" {} ''
mkdir -p $out

${pkgs.jdk24}/bin/java -XX:AOTMode=record -XX:AOTConfiguration=$out/app.aotconf -jar ${epubcheck_jar} --help
${pkgs.jdk24}/bin/java -XX:AOTMode=create -XX:AOTConfiguration=$out/app.aotconf -XX:AOTCache=$out/app.aot -jar ${epubcheck_jar} --help
		'';
	epubcheck = pkgs.writeShellScriptBin "epubcheck" ''
${pkgs.jdk24}/bin/java -XX:AOTCache=${epubcheck_jsa}/app.aot -XX:AOTMode=on -jar ${epubcheck_jar} "$@"
	'';
in {
	variables = {
		WEBSITE_VALIDATOR_VNU = ''${vnu}/bin/vnu'';
		WEBSITE_VALIDATOR_EPUBCHECK = ''${epubcheck}/bin/epubcheck'';
	};
	inherit pkgs;
}

