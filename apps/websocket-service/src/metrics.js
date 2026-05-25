import { createServer } from 'http'


import client from 'prom-client'

const register = new client.Registry()
client.collectDefaultMetrics({ register })

export const wsConnectionsActive = new client.Gauge({
  name: 'socket_io_connections_active',
  help: 'Number of active Socket.IO connections',
  registers: [register],
})

export const wsMessagesTotal = new client.Counter({
  name: 'socket_io_events_total',
  help: 'Total Socket.IO events',
  labelNames: ['event_name'],
  registers: [register],
})

export const wsMessageLatency = new client.Histogram({
  name: 'websocket_message_latency_seconds',
  help: 'WebSocket message propagation latency',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
  registers: [register],
})

export const wsDisconnectionsTotal = new client.Counter({
  name: 'websocket_disconnections_total',
  help: 'Total WebSocket disconnections',
  registers: [register],
})

export { register }