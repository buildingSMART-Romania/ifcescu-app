// Static data + IFC naming used across the viewer.

// Romanian national projected CRS (Stereo 70). Used when reading/placing a
// georeferenced model. EPSG:3844 = Pulkovo 1942(58) / Stereo70.
export const STEREO70 = {
  name: "EPSG:3844",
  description: "Pulkovo 1942(58) / Stereo70",
  geodeticDatum: "Pulkovo 1942(58)",
  mapProjection: "Stereo70",
  verticalDatum: "Marea Neagră 1975",
};

// Rough Stereo 70 extents over Romania (metres) for soft validation only.
// Y = Nord (Northings), X = Est (Eastings).
export const STEREO70_BOUNDS = { eMin: 100000, eMax: 900000, nMin: 200000, nMax: 800000 };
