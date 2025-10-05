{
  pkgs,
}:

let
	deps_json = pkgs.writeTextFile{
		name = "deps.json";
		text = builtins.toJSON {java = pkgs.jdk;};
	};

in deps_json

