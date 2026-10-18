import config from './config/release-notes.json' with {type:'json'};

// Group user-facing milestones manually; newest version first.
export const currentVersion=config.currentVersion;
export const releaseNotes=config.versions;
