plugins {
    id("com.android.application")
}

android {
    namespace = "io.github.penguingrenade.toppleparty"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.penguingrenade.toppleparty"
        minSdk = 21
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        // Optional: set TOPPLE_KEYSTORE / TOPPLE_KEYSTORE_PASSWORD to sign releases with your own key.
        val ks = System.getenv("TOPPLE_KEYSTORE")
        if (ks != null && file(ks).exists()) {
            create("release") {
                storeFile = file(ks)
                storePassword = System.getenv("TOPPLE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("TOPPLE_KEY_ALIAS") ?: "topple"
                keyPassword = System.getenv("TOPPLE_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
