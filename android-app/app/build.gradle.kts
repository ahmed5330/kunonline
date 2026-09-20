plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.kunonline.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.kunonline.mobile"
        minSdk = 29
        targetSdk = 35
        versionCode = 4
        versionName = "0.1.3"
        buildConfigField("String", "KUN_BASE_URL", "\"https://app.kun-online.com\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
