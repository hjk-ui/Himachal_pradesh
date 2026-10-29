/**
 * Peer support no longer uses ClinicModuleState lists, so there is nothing to seed.
 *
 *   npm run db:seed:peer-support
 *
 * Contacts, recovery goals and community placements live in peer_contacts / peer_goals /
 * peer_placements (migration 20261018_peer_support.sql) and are entered per client on
 * /dashboard/peer-support. This script used to overwrite the old 'peer-*' lists, which would
 * erase entries still waiting to be filed with "Import legacy entries", so it now only reports.
 */
console.log('Peer support has no seed data. Records are entered per client on /dashboard/peer-support.');
