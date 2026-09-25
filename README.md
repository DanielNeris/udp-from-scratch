# udp-from-scratch

A reliable transport built on raw UDP in Node.js, no dependencies. Each piece was
added because the previous one left a visible problem, which makes this a record of
what TCP actually solves rather than a reimplementation of it.

```bash
node server.js    # terminal 1, listens on 41234
node client.js    # terminal 2, handshakes then sends 5 packets
```

---

## Wire format

5-byte header, big endian (network byte order), followed by the payload.

| Offset | Size | Field   | Type       |
| ------ | ---- | ------- | ---------- |
| 0      | 4 B  | seq     | `uint32be` |
| 4      | 1 B  | flags   | `uint8`    |
| 5      | var  | payload | bytes      |

Flags are a bitmask, one bit each, so they combine in a single byte:

| Flag | Value | Bits        |
| ---- | ----- | ----------- |
| ACK  | 0x01  | `0000 0001` |
| SYN  | 0x02  | `0000 0010` |

`SYN | ACK` is `0x03`, which is why a syn+ack fits in one packet rather than two.
Tested with `flags & FLAG_ACK` rather than equality, so the check keeps working as
more flags are added.

4 bytes for `seq` rather than 1: a one-byte counter wraps after 255, and a delayed
packet arriving after the wrap is indistinguishable from a fresh one.

---

## How it evolved

### 1. A socket that only listens

Seven lines: `createSocket`, an `on('message')` handler, `bind(41234)`.

Tested with `nc -u` before writing a client at all, which proved the socket accepts
datagrams from anything, not just from code I wrote.

### 2. A client

No `bind` call anywhere, so the kernel assigns an ephemeral port at the first `send`.
Every run shows a different source port on the server.

The `send` callback reports whether the kernel accepted the packet, never whether it
arrived.

### 3. A sequence number

4 bytes prepended to the body. At this point both sides agree that the first bytes
mean something and the rest is content, which is all a protocol is.

### 4. Gap detection, and the bug it exposed

A single `expected` counter on the server reported a gap every time a new client
connected: each client starts at seq 0, but `expected` was still 5 from the previous
one. Seven independent conversations were being tracked as one.

Sequence numbers are meaningless without a context to scope them to, and that context
is what a connection is. Fixed with a `Map` keyed on `address:port`.

### 5. A flags byte

Needed because an ack and a zero-length message were byte-identical on the wire. The
receiver had no way to tell them apart.

### 6. Acks

The server echoes back seq with `FLAG_ACK` set and no payload.

The `if ((flags & FLAG_ACK) === 0)` guard matters: without it the server acks its own
acks and the two sides bounce 5-byte packets forever.

### 7. Retransmission

The client keeps a `Map` of unacked packets, each with its own retransmit timer. An
ack clears the timer and deletes the entry; a timeout resends.

Verified by starting the client with no server running, letting it retransmit six
times, then starting the server: all five packets completed. Nothing in the network
reported the failure, and the transport recovered anyway.

### 8. A three-way handshake, added to fix the peer map

Before this, any datagram allocated an entry in the server's `Map`, so datagrams from
many spoofed source ports would allocate state for peers that never existed.

Now the server answers a syn with syn+ack but allocates nothing, and only creates
state when the third packet arrives. Verified with:

```bash
echo -n "AAAA" | nc -u -w1 127.0.0.1 41234
```

which is now dropped with no state created.

Note what this handshake does _not_ do: unlike TCP, it negotiates no initial sequence
number, because both sides here start at 0 unconditionally. Its only job is proof of
address.

---

## Known limitations

| Limitation                              | Why it matters                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The syn is never retransmitted          | Only data packets carry a timer. A lost syn leaves the client waiting for a syn+ack that never arrives, and it sends nothing at all.                                                                                                                                               |
| Retransmits forever                     | No attempt limit, no give-up condition. A dead peer keeps the client alive indefinitely.                                                                                                                                                                                           |
| Fixed 300 ms timeout                    | Should be derived from observed RTT with a moving average and variance, and doubled on each retry. A fixed value is either too slow on a good link or too aggressive on a bad one.                                                                                                 |
| No flow or congestion control           | All packets go out at once with no window. Five is fine; ten thousand would flood both the link and the receiver.                                                                                                                                                                  |
| The handshake only stops blind spoofing | An attacker who can forge a source address _and_ receive the replies completes it normally. The real defence is a syn cookie: derive a value cryptographically, put it in the syn+ack, and accept the third packet only if it comes back, so the server stores nothing in between. |
| Established connections never expire    | The `Map` no longer grows from unsolicited traffic, but nothing removes idle peers either.                                                                                                                                                                                         |

---

## Background

- CS144 (Stanford), units 1 and 2: https://cs144.github.io/
- Node `dgram`: https://nodejs.org/api/dgram.html
# udp-from-scratch
