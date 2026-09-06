// Injected into the Leaflet WebView (see LeafletMap.tsx / LiveLeafletMap.tsx)
// alongside the bundled Leaflet JS. Defines a tile layer that tries a local
// file:// tile first (downloaded ahead of time via offlineMap.ts) and only
// falls back to the network OSM tile if no local copy exists - so a map
// whose area was downloaded still shows real street imagery with no
// connection at all, while an undownloaded area behaves exactly as before
// (network tile, or blank if that fails too).
export const OFFLINE_TILE_LAYER_JS = `
function makeTileLayer(offlineDir) {
  var onlineUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  if (!offlineDir) return L.tileLayer(onlineUrl);
  var OfflineTileLayer = L.TileLayer.extend({
    createTile: function (coords, done) {
      var tile = document.createElement('img');
      var onlineSrc = this.getTileUrl(coords);
      var localSrc = offlineDir + coords.z + '/' + coords.x + '/' + coords.y + '.png';
      tile.onload = function () { done(null, tile); };
      tile.onerror = function () {
        if (tile.src !== onlineSrc) {
          tile.onerror = function () { done(null, tile); };
          tile.src = onlineSrc;
        } else {
          done(null, tile);
        }
      };
      tile.src = localSrc;
      return tile;
    },
  });
  return new OfflineTileLayer(onlineUrl);
}
`;
