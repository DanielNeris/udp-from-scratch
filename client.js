const dgram = require('node:dgram')

const PORT = 41234
const HOST = '127.0.0.1'
const TIMEOUT = 300

const FLAG_ACK = 0x01
const FLAG_SYN = 0x02

const socket = dgram.createSocket('udp4')

const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo']

// Packets in flight: sent, not yet acked. Each holds its own retransmit timer.
const pending = new Map()

function send(seq) {
  const entry = pending.get(seq)

  socket.send(entry.packet, PORT, HOST)

  entry.timer = setTimeout(() => {
    console.log(`timeout: resending seq=${seq}`)
    send(seq)
  }, TIMEOUT)
}

function handshake() {
  const syn = Buffer.alloc(5)
  syn.writeUInt32BE(0, 0)
  syn.writeUInt8(FLAG_SYN, 4)

  console.log('sending syn')
  socket.send(syn, PORT, HOST)
}

function sendAll() {
  for (let seq = 0; seq < words.length; seq++) {
    const body = Buffer.from(words[seq])

    const header = Buffer.alloc(5)
    header.writeUInt32BE(seq, 0)
    header.writeUInt8(0, 4)

    pending.set(seq, { packet: Buffer.concat([header, body]), timer: null })

    console.log(`sent: seq=${seq} "${words[seq]}"`)
    send(seq)
  }
}

socket.on('message', (msg) => {
  if (msg.length < 5) return

  const seq = msg.readUInt32BE(0)
  const flags = msg.readUInt8(4)

  // Step 2 of 3: syn+ack arrived. Complete the handshake, then start sending.
  if ((flags & FLAG_SYN) && (flags & FLAG_ACK)) {
    console.log('got syn+ack, sending ack')

    const ack = Buffer.alloc(5)
    ack.writeUInt32BE(seq, 0)
    ack.writeUInt8(FLAG_ACK, 4)

    socket.send(ack, PORT, HOST)
    sendAll()
    return
  }

  if ((flags & FLAG_ACK) === 0) return

  const entry = pending.get(seq)
  if (!entry) return

  clearTimeout(entry.timer)
  pending.delete(seq)

  console.log(`ack for seq=${seq}, ${pending.size} pending`)

  if (pending.size === 0) {
    console.log('all acked')
    socket.close()
  }
})

handshake()