# Core plugin template

Copy this folder into a new package and replace the example name and processor.
Plugins register capabilities through `GISApp` public methods and pass the
provided `ResourceScope` to registrations that must be released on init failure
or app disposal. Keep Vue and map-engine imports out of Core plugins.
