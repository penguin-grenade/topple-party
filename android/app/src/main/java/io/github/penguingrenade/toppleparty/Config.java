package io.github.penguingrenade.toppleparty;

/** Build-time settings. The GitHub Actions workflow rewrites GAME_URL to match the repo's Pages URL. */
final class Config {
    static final String GAME_URL = "https://penguin-grenade.github.io/topple-party/";

    private Config() {}
}
