# Managed LAN discovery

Discovery runs in Electron main after the current workspace and device policy authorize the listener. Provisioning supplies a CA, device certificate, pinned peer fingerprints, up to 254 private IPv4 addresses and three distinct unprivileged ports. Certificates, endpoints and reservations do not authorize corporate business changes.

## Peer exchange and verification

Protocol 2 exchanges the active peer list and the current scan reservation table over workspace-bound mutual TLS. A direct peer must have a provisioned certificate. An indirectly learned endpoint remains a hint until a new connection verifies its exact pinned identity and workspace response. Hints cannot expand the configured address, port or fingerprint allowlists.

A peer list holds at most 256 entries. Frames are bounded to 256 KiB, malformed or duplicate table entries fail closed, and one connection carries one request and reply. Heartbeats, scan reservations and endpoint verification share a two-connection outgoing limit. Incoming connections remain capped at 32, with incomplete requests timed out. Data relay keeps its separate bounded envelope contract.

The listener retains three-port fallback. Heartbeats run every minute and remove unreachable peers. Discovery runs on startup and every ten minutes. Known endpoints retained across a stop/start are reverified as hints; they are not shown as live peers while stopped. Legacy peers can still exchange relay envelopes and answer pings, but cannot coordinate scans.

## Bounded scanning

Among currently connected protocol-2 peers, the lowest certificate fingerprint is the coordinator. Before probing all three ports of an address, a device reserves an attempt with that coordinator. Grants are bound to the authenticated device identity and a unique request identifier. The reservation table allows at most two grants per address per ten-minute clock round; gossip carries consumed reservations through coordinator replacement.

Each transport instance also limits itself to two attempts per configured address per round. Stop/start of that instance preserves its budget. Remote tables cannot advance its clock round, and local clock rollback cannot reopen a consumed budget. Reservations are consumed before probes: a lost reply or interrupted scan may leave unused capacity unavailable until the next round.

These are bounds on **subnet scans**, not on heartbeat or known-endpoint verification traffic. Hint verification is separately bounded to 256 candidates per pass, with a bounded recent-attempt cache and one-minute suppression of a repeated endpoint.

This is not distributed consensus. Simultaneous startup, network partitions, different clock rounds, process reconstruction and legacy peers can produce more than two scans across the whole network. Disconnected partitions each have their own coordinator. After reconnection, merging saturated tables prevents additional grants in the same round, but cannot undo probes that already happened. This is the approved replacement for the original absolute no-redundant-scan requirement.

## Acceptance boundaries

Real TLS loopback tests verify peer exchange, pin and scope rejection, bounded shared scans, coordinator loss, partition-table convergence and restart behavior. Native journeys verify that discovery continues to support scoped draft relay, protected recovery and verified package installation. Deployment-network tests with provisioned production certificates, additional operating systems, and employee/offline authority remain required under SDK-05/OPS-01. The [persistent shell indicator](verification/lan-status/README.md) shares the native status with Settings and has scoped keyboard/narrow/lifecycle acceptance.
