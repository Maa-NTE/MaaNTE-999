import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'

const DATA_FILE = process.env.MAANTE_MAP_DATA_FILE
  ? path.resolve(process.env.MAANTE_MAP_DATA_FILE)
  : fileURLToPath(new URL('./src/data/map-data.json', import.meta.url))
const COORDINATE_CALIBRATION_FILE = process.env.MAANTE_COORDINATE_CALIBRATION_FILE
  ? path.resolve(process.env.MAANTE_COORDINATE_CALIBRATION_FILE)
  : fileURLToPath(new URL('./src/data/navi-coordinate-calibration.json', import.meta.url))
const MAP_LAYER_GEOFENCES_FILE = process.env.MAANTE_MAP_LAYER_GEOFENCES_FILE
  ? path.resolve(process.env.MAANTE_MAP_LAYER_GEOFENCES_FILE)
  : fileURLToPath(new URL('./src/data/map-layer-geofences.json', import.meta.url))
const MAP_LAYER_CALIBRATIONS_FILE = process.env.MAANTE_MAP_LAYER_CALIBRATIONS_FILE
  ? path.resolve(process.env.MAANTE_MAP_LAYER_CALIBRATIONS_FILE)
  : fileURLToPath(new URL('./src/data/map-layer-calibrations.json', import.meta.url))
const MAP_LAYER_TRANSFORMS_FILE = process.env.MAANTE_MAP_LAYER_TRANSFORMS_FILE
  ? path.resolve(process.env.MAANTE_MAP_LAYER_TRANSFORMS_FILE)
  : fileURLToPath(new URL('./src/data/map-layer-transforms.json', import.meta.url))
const UPLOADS_DIR = process.env.MAANTE_UPLOADS_DIR
  ? path.resolve(process.env.MAANTE_UPLOADS_DIR)
  : fileURLToPath(new URL('./public/images/uploads', import.meta.url))
const MAPS_DIR = fileURLToPath(new URL('./public/maps', import.meta.url))
const MAP_TILES_MANIFEST = fileURLToPath(new URL('./public/map-tiles/manifest.json', import.meta.url))

function computeMapAssetVersion() {
  try {
    if (fs.existsSync(MAP_TILES_MANIFEST)) {
      const manifest = JSON.parse(fs.readFileSync(MAP_TILES_MANIFEST, 'utf8'))
      if (manifest?.version) return String(manifest.version)
    }

    if (!fs.existsSync(MAPS_DIR)) return String(Date.now())
    const signature = fs.readdirSync(MAPS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const stat = fs.statSync(path.join(MAPS_DIR, entry.name))
        return `${entry.name}:${stat.size}:${Math.trunc(stat.mtimeMs)}`
      })
      .sort()
      .join('|')
    return signature
      ? crypto.createHash('sha1').update(signature).digest('hex').slice(0, 12)
      : String(Date.now())
  } catch {
    return String(Date.now())
  }
}

const MAP_ASSET_VERSION = computeMapAssetVersion()

function sendJson(response, payload, statusCode = 200) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => { chunks.push(Buffer.from(chunk)) })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')))
    request.on('error', reject)
  })
}

function findReplacementCharacters(value, pathParts = []) {
  if (typeof value === 'string') {
    return value.includes('\uFFFD') ? [pathParts.join('.') || '$'] : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findReplacementCharacters(item, [...pathParts, String(index)]))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => findReplacementCharacters(item, [...pathParts, key]))
  }
  return []
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  return ({
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  })[extension] || 'application/octet-stream'
}

function normalizeCoordinateCalibration(data) {
  const sourceWidth = Number(data?.sourceWidth)
  const sourceHeight = Number(data?.sourceHeight)
  const points = Array.isArray(data?.points)
    ? data.points.slice(0, 3).map((point) => ({
        raw: Array.isArray(point?.raw) ? point.raw.map(Number).slice(0, 3) : [],
        map: Array.isArray(point?.map) ? point.map.map(Number).slice(0, 2) : [],
      }))
    : []

  if (!Number.isFinite(sourceWidth) || sourceWidth <= 0 || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
    throw new Error('Invalid coordinate source size')
  }

  if (points.length !== 3 || points.some((point) => (
    point.raw.length < 2
    || point.map.length < 2
    || ![point.raw[0], point.raw[1], point.map[0], point.map[1]].every(Number.isFinite)
  ))) {
    throw new Error('Invalid coordinate calibration points')
  }

  return {
    version: Number(data?.version) || 1,
    sourceWidth,
    sourceHeight,
    points: points.map((point) => ({
      raw: [
        point.raw[0],
        point.raw[1],
        Number.isFinite(point.raw[2]) ? point.raw[2] : 0,
      ],
      map: [point.map[0], point.map[1]],
    })),
  }
}

function readJsonFile(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function assertPlainRecord(data, label) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Invalid ${label}`)
  }
}

function normalizeLayerCalibration(value) {
  const points = Array.isArray(value?.points)
    ? value.points.slice(0, 3).map((point) => ({
        raw: Array.isArray(point?.raw) ? point.raw.map(Number).slice(0, 2) : [],
        map: Array.isArray(point?.map) ? point.map.map(Number).slice(0, 2) : [],
      }))
    : []

  if (points.length !== 3 || points.some((point) => (
    point.raw.length < 2
    || point.map.length < 2
    || ![point.raw[0], point.raw[1], point.map[0], point.map[1]].every(Number.isFinite)
  ))) {
    throw new Error('Invalid layer calibration points')
  }

  return {
    version: Number(value?.version) || 1,
    calibrated: value?.calibrated === true,
    ...(typeof value?.calibratedAt === 'string' ? { calibratedAt: value.calibratedAt } : {}),
    points,
  }
}

function normalizeMapLayerCalibrations(data) {
  assertPlainRecord(data, 'map layer calibrations')
  return Object.fromEntries(Object.entries(data).map(([layerId, calibration]) => [
    layerId,
    normalizeLayerCalibration(calibration),
  ]))
}

function normalizeCoordinateTransform(value) {
  const rotation = value?.rotationDegrees || {}
  const plane = ['xoy', 'yoz', 'xoz'].includes(value?.plane) ? value.plane : 'xoy'
  const mirrorPlanes = Array.isArray(value?.mirrorPlanes)
    ? value.mirrorPlanes.filter((item) => ['xoy', 'yoz', 'xoz', 'xy', 'yz', 'xz'].includes(item))
    : []
  return {
    rotationDegrees: {
      x: Number(rotation.x) || 0,
      y: Number(rotation.y) || 0,
      z: Number(rotation.z) || 0,
    },
    plane,
    mirrorPlanes,
    flipAxes: {
      x: value?.flipAxes?.x === true || value?.flipAxes?.x === -1,
      y: value?.flipAxes?.y === true || value?.flipAxes?.y === -1,
      z: value?.flipAxes?.z === true || value?.flipAxes?.z === -1,
    },
    offset: {
      x: Number(value?.offset?.x) || 0,
      y: Number(value?.offset?.y) || 0,
      z: Number(value?.offset?.z) || 0,
    },
  }
}

function normalizeMapLayerTransforms(data) {
  assertPlainRecord(data, 'map layer transforms')
  return Object.fromEntries(Object.entries(data).map(([layerId, transform]) => [
    layerId,
    normalizeCoordinateTransform(transform),
  ]))
}

function normalizeLayerGeofence(value) {
  if (!value || value.enabled !== true) return { enabled: false }
  const zMin = Number(value.zMin)
  const zMax = Number(value.zMax)
  let points = Array.isArray(value.points)
    ? value.points
      .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    : []

  if (points.length < 3) {
    const xMin = Number(value.xMin)
    const xMax = Number(value.xMax)
    const yMin = Number(value.yMin)
    const yMax = Number(value.yMax)
    if ([xMin, xMax, yMin, yMax].every(Number.isFinite)) {
      const left = Math.min(xMin, xMax)
      const right = Math.max(xMin, xMax)
      const top = Math.min(yMin, yMax)
      const bottom = Math.max(yMin, yMax)
      points = [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom },
      ]
    }
  }

  if (points.length < 3 || ![zMin, zMax].every(Number.isFinite)) {
    throw new Error('Invalid layer geofence')
  }
  return {
    enabled: true,
    points,
    zMin: Math.min(zMin, zMax),
    zMax: Math.max(zMin, zMax),
  }
}

function normalizeMapLayerGeofences(data) {
  assertPlainRecord(data, 'map layer geofences')
  return Object.fromEntries(Object.entries(data).map(([layerId, geofence]) => [
    layerId,
    normalizeLayerGeofence(geofence),
  ]))
}

function createJsonStoreMiddleware(filePath, normalize, responseKey) {
  return async (request, response) => {
    if (request.method === 'GET') {
      sendJson(response, readJsonFile(filePath, {}))
      return
    }

    if (request.method !== 'POST') {
      sendJson(response, { error: 'Method not allowed' }, 405)
      return
    }

    try {
      const data = normalize(JSON.parse(await readBody(request)))
      fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
      sendJson(response, { ok: true, [responseKey]: data })
    } catch (error) {
      sendJson(response, { error: error.message }, 400)
    }
  }
}

function localMapEditorPlugin() {
  return {
    name: 'local-map-editor',
    configureServer(server) {
      server.middlewares.use('/images/uploads', (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          next()
          return
        }

        const pathname = new URL(request.url || '/', 'http://localhost').pathname
        const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '')
        if (!relativePath) {
          next()
          return
        }

        const filePath = path.resolve(UPLOADS_DIR, relativePath)
        if (!filePath.startsWith(`${UPLOADS_DIR}${path.sep}`) || !fs.existsSync(filePath)) {
          next()
          return
        }

        response.setHeader('Content-Type', contentTypeFor(filePath))
        if (request.method === 'HEAD') {
          response.end()
          return
        }
        fs.createReadStream(filePath).pipe(response)
      })

      server.middlewares.use('/api/map-data', async (request, response) => {
        if (request.method === 'GET') {
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(fs.readFileSync(DATA_FILE, 'utf8'))
          return
        }

        if (request.method !== 'POST') {
          sendJson(response, { error: 'Method not allowed' }, 405)
          return
        }

        try {
          const data = JSON.parse(await readBody(request))
          if (!Array.isArray(data.categories) || !Array.isArray(data.locations) || !Array.isArray(data.routes)) {
            sendJson(response, { error: 'Invalid map data' }, 400)
            return
          }
          const replacementPaths = findReplacementCharacters(data)
          if (replacementPaths.length) {
            sendJson(response, {
              error: 'Refusing to save text that contains replacement characters.',
              paths: replacementPaths.slice(0, 20),
            }, 400)
            return
          }
          fs.writeFileSync(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
          sendJson(response, { ok: true })
        } catch (error) {
          sendJson(response, { error: error.message }, 500)
        }
      })

      server.middlewares.use('/api/coordinate-calibration', async (request, response) => {
        if (request.method === 'GET') {
          sendJson(response, readJsonFile(COORDINATE_CALIBRATION_FILE, {}))
          return
        }

        if (request.method !== 'POST') {
          sendJson(response, { error: 'Method not allowed' }, 405)
          return
        }

        try {
          const data = normalizeCoordinateCalibration(JSON.parse(await readBody(request)))
          fs.writeFileSync(COORDINATE_CALIBRATION_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
          sendJson(response, { ok: true, calibration: data })
        } catch (error) {
          sendJson(response, { error: error.message }, 400)
        }
      })

      server.middlewares.use('/api/map-layer-calibrations',
        createJsonStoreMiddleware(MAP_LAYER_CALIBRATIONS_FILE, normalizeMapLayerCalibrations, 'calibrations'))

      server.middlewares.use('/api/map-layer-transforms',
        createJsonStoreMiddleware(MAP_LAYER_TRANSFORMS_FILE, normalizeMapLayerTransforms, 'transforms'))

      server.middlewares.use('/api/map-layer-geofences',
        createJsonStoreMiddleware(MAP_LAYER_GEOFENCES_FILE, normalizeMapLayerGeofences, 'geofences'))

      server.middlewares.use('/api/upload-image', async (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, { error: 'Method not allowed' }, 405)
          return
        }

        try {
          const { dataUrl, name = 'image' } = JSON.parse(await readBody(request))
          const match = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i.exec(dataUrl || '')
          if (!match) {
            sendJson(response, { error: 'Invalid image data' }, 400)
            return
          }
          fs.mkdirSync(UPLOADS_DIR, { recursive: true })
          const extension = match[1].toLowerCase().replace('jpeg', 'jpg')
          const stem = path.basename(name, path.extname(name)).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'image'
          const filename = `${Date.now()}-${stem}.${extension}`
          fs.writeFileSync(path.join(UPLOADS_DIR, filename), Buffer.from(match[2], 'base64'))
          sendJson(response, { ok: true, path: `/images/uploads/${filename}` })
        } catch (error) {
          sendJson(response, { error: error.message }, 500)
        }
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [vue(), localMapEditorPlugin()],
  define: {
    __MAP_ASSET_VERSION__: JSON.stringify(MAP_ASSET_VERSION),
  },
  server: {
    // The editor writes this file through /api/map-data. Reloading the page
    // after that write would discard the user's current filters and map state.
    watch: {
      ignored: [DATA_FILE],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('map-data.json')) return 'markers'
        },
      },
    },
  },
})
