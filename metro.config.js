// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Keep the server-side package out of the mobile bundler entirely. Nothing in
// `backend/` is importable from the app by design (ADR-001), and leaving it in
// the watch tree only invites duplicate-module warnings and a slower crawl.
config.resolver.blockList = [/[/\\]backend[/\\].*/];

module.exports = config;
