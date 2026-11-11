#!/usr/bin/env bash
# Starts MongoDB 7 as a single-node replica set on :27017 (transactions need a replica set).
set -euo pipefail
IMAGE="${MONGO_IMAGE:-mongo:7}"
PORT="${MONGO_PORT:-27017}"
docker run -d --name ahq-ci-mongo -p "$PORT":27017 "$IMAGE" --replSet rs0 --bind_ip_all >/dev/null
for _ in $(seq 1 60); do
  if docker exec ahq-ci-mongo mongosh --quiet --eval \
    "try { rs.status().ok } catch (e) { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] }).ok }; quit(db.hello().isWritablePrimary ? 0 : 1)" \
    >/dev/null 2>&1; then
    echo "MongoDB replica set rs0 is primary"
    exit 0
  fi
  sleep 2
done
echo "MongoDB did not become primary in time" >&2
docker logs ahq-ci-mongo | tail -50 >&2
exit 1
