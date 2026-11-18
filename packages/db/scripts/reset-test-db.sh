#!/usr/bin/env bash
# Test veritabanını sıfırdan kurar (yalnızca yerel geliştirme).
set -euo pipefail
SUPER_URL=${SUPER_URL:-postgres://postgres@localhost:5432/postgres}
DB=${DB:-lawgent_test}
psql -q "$SUPER_URL" -c "drop database if exists $DB" -c "create database $DB owner lawgent_owner"
psql -q "${SUPER_URL%/*}/$DB" -c "create extension vector; create extension citext; create extension pg_trgm; create extension unaccent"
