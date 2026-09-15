plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.kunonline.callerid"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.kunonline.callerid"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }
}
