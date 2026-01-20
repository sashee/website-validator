{
}:

let
  nixpkgs = fetchTarball "https://github.com/NixOS/nixpkgs/tarball/nixos-25.11";
  pkgs = import nixpkgs { config = {}; overlays = []; };
in {
	variables = {
		WEBSITE_VALIDATOR_VNU = ''${pkgs.validator-nu}/bin/vnu'';
		WEBSITE_VALIDATOR_EPUBCHECK = ''${pkgs.epubcheck}/bin/epubcheck'';
	};
	inherit pkgs;
}

