import L from 'leaflet'
import { publicAssetUrl } from './assets'

export const MAP_TILE_SIZE = 256
export const MAP_TILE_MIN_ZOOM = -8
export const MAP_TILE_MAX_NATIVE_ZOOM = 0

const MAP_ASSET_VERSION = typeof __MAP_ASSET_VERSION__ === 'undefined'
  ? 'dev'
  : __MAP_ASSET_VERSION__

const mapTileImageCache = new Map()

function imageSize(layer) {
  return {
    width: Number(layer.image?.width || layer.width),
    height: Number(layer.image?.height || layer.height),
  }
}

function versionedMapTileUrl(layerId, z, x, y) {
  return publicAssetUrl(
    `/map-tiles/${encodeURIComponent(layerId)}/${z}/${x}/${y}.webp?v=${encodeURIComponent(MAP_ASSET_VERSION)}`,
  )
}

function loadMapTileImage(url) {
  if (mapTileImageCache.has(url)) return mapTileImageCache.get(url)
  const promise = new Promise((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
  mapTileImageCache.set(url, promise)
  return promise
}

function clampTileZoom(zoom) {
  return Math.max(MAP_TILE_MIN_ZOOM, Math.min(MAP_TILE_MAX_NATIVE_ZOOM, Number(zoom) || 0))
}

async function drawSourceTilesToCanvas(canvas, sourceLayer, offsetX, offsetY, coords) {
  const tileSize = MAP_TILE_SIZE
  const z = clampTileZoom(coords.z)
  const scale = 2 ** z
  const tileMapX = coords.x * tileSize / scale
  const tileMapY = coords.y * tileSize / scale
  const tileMapWidth = tileSize / scale
  const tileMapHeight = tileSize / scale
  const { width: imageWidth, height: imageHeight } = imageSize(sourceLayer)
  const imageLeft = offsetX
  const imageTop = offsetY
  const imageRight = imageLeft + imageWidth
  const imageBottom = imageTop + imageHeight
  const overlapLeft = Math.max(tileMapX, imageLeft)
  const overlapTop = Math.max(tileMapY, imageTop)
  const overlapRight = Math.min(tileMapX + tileMapWidth, imageRight)
  const overlapBottom = Math.min(tileMapY + tileMapHeight, imageBottom)
  if (overlapLeft >= overlapRight || overlapTop >= overlapBottom) return

  const sourceLeft = (overlapLeft - imageLeft) * scale
  const sourceTop = (overlapTop - imageTop) * scale
  const sourceRight = (overlapRight - imageLeft) * scale
  const sourceBottom = (overlapBottom - imageTop) * scale
  const firstSourceTileX = Math.floor(sourceLeft / tileSize)
  const firstSourceTileY = Math.floor(sourceTop / tileSize)
  const lastSourceTileX = Math.floor((sourceRight - 0.001) / tileSize)
  const lastSourceTileY = Math.floor((sourceBottom - 0.001) / tileSize)
  const context = canvas.getContext('2d')
  context.imageSmoothingEnabled = z !== 0
  context.imageSmoothingQuality = 'high'

  const drawTasks = []
  for (let sourceTileY = firstSourceTileY; sourceTileY <= lastSourceTileY; sourceTileY += 1) {
    for (let sourceTileX = firstSourceTileX; sourceTileX <= lastSourceTileX; sourceTileX += 1) {
      drawTasks.push((async () => {
        const image = await loadMapTileImage(versionedMapTileUrl(sourceLayer.id, z, sourceTileX, sourceTileY))
        if (!image) return
        const sourceTileLeft = sourceTileX * tileSize
        const sourceTileTop = sourceTileY * tileSize
        const cropLeft = Math.max(sourceLeft, sourceTileLeft)
        const cropTop = Math.max(sourceTop, sourceTileTop)
        const cropRight = Math.min(sourceRight, sourceTileLeft + tileSize)
        const cropBottom = Math.min(sourceBottom, sourceTileTop + tileSize)
        if (cropLeft >= cropRight || cropTop >= cropBottom) return
        const cropWidth = cropRight - cropLeft
        const cropHeight = cropBottom - cropTop
        const destX = cropLeft + (imageLeft - tileMapX) * scale
        const destY = cropTop + (imageTop - tileMapY) * scale
        context.drawImage(
          image,
          cropLeft - sourceTileLeft,
          cropTop - sourceTileTop,
          cropWidth,
          cropHeight,
          destX,
          destY,
          cropWidth,
          cropHeight,
        )
      })())
    }
  }

  await Promise.all(drawTasks)
}

const MapImageTileLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const canvas = L.DomUtil.create('canvas', 'map-image-tile')
    canvas.width = MAP_TILE_SIZE
    canvas.height = MAP_TILE_SIZE
    const { sourceLayer, item } = this.options
    drawSourceTilesToCanvas(
      canvas,
      sourceLayer,
      Number(item?.x) || 0,
      Number(item?.y) || 0,
      coords,
    ).then(
      () => done(null, canvas),
      () => done(null, canvas),
    )
    return canvas
  },
})

export function createMapTileLayer(layer, item = { x: 0, y: 0 }, options = {}) {
  const { width, height } = imageSize(layer)
  const bounds = L.latLngBounds(
    [-(Number(item.y || 0) + height), Number(item.x || 0)],
    [-Number(item.y || 0), Number(item.x || 0) + width],
  )
  return new MapImageTileLayer({
    sourceLayer: layer,
    item,
    bounds,
    tileSize: MAP_TILE_SIZE,
    minNativeZoom: MAP_TILE_MIN_ZOOM,
    maxNativeZoom: MAP_TILE_MAX_NATIVE_ZOOM,
    minZoom: MAP_TILE_MIN_ZOOM,
    maxZoom: 2,
    noWrap: true,
    keepBuffer: 2,
    updateWhenIdle: false,
    updateWhenZooming: false,
    ...options,
  })
}
