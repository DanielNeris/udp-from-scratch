const dgram = require('node:dgram')

const PORT = 41234

const FLAG_ACK = 0x01
const FLAG_SYN = 0x02

const socket = dgram.createSocket('udp4')

// Established connections only. A peer gets an entry here after completing
// the three-way handshake, never just by sending us a datagram.
const connections = new Map()

socket.on('message', (msg, rinfo) => {
  if (msg.length < 5) return

  const key = `${rinfo.address}:${rinfo.port}`
  const seq = msg.readUInt32BE(0)
  const flags = msg.readUInt8(4)
  const payload = msg.subarray(5)

  // Step 1 of 3: reply to the syn, but allocate nothing yet.
  if (flags & FLAG_SYN) {
    console.log(`syn from ${key}, sending syn+ack`)

    const res = Buffer.alloc(5)
    res.writeUInt32BE(seq, 0)
    res.writeUInt8(FLAG_SYN | FLAG_ACK, 4)

    socket.send(res, rinfo.port, rinfo.address)
    return
  }

  // Step 3 of 3: a bare ack with no payload completes the handshake.
  // Only now does this peer cost us memory.
  if ((flags & FLAG_ACK) && !connections.has(key) && payload.length === 0) {
    connections.set(key, 0)
    console.log(`connection established with ${key}`)
    return
  }

  // Anything from a peer that never handshook is discarded.
  if (!connections.has(key)) {
    console.log(`  dropped: no connection from ${key}`)
    return
  }

  const expected = connections.get(key)
  if (seq !== expected) {
    console.log(`  gap on ${key}: expected ${expected}, got ${seq}`)
  }
  connections.set(key, seq + 1)

  console.log(`server got: seq=${seq} ${payload.length}B from ${key}`)

  // Never ack an ack, or the two sides bounce 5-byte packets forever.
  if ((flags & FLAG_ACK) === 0) {
    const ack = Buffer.alloc(5)
    ack.writeUInt32BE(seq, 0)
    ack.writeUInt8(FLAG_ACK, 4)

    socket.send(ack, rinfo.port, rinfo.address)
  }
})

socket.bind(PORT)

console.log(`listening on ${PORT}`)