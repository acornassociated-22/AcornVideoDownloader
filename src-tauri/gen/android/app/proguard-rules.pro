# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Keep line numbers for crash reports if minify is re-enabled later.
-keepattributes SourceFile,LineNumberTable,*Annotation*,InnerClasses,EnclosingMethod,Signature

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Tauri plugins + invoke args (reflection from Rust IPC).
-keep @app.tauri.annotation.TauriPlugin class * { *; }
-keep @app.tauri.annotation.InvokeArg class * { *; }
-keep class app.tauri.** { *; }

# youtubedl-android / ffmpeg — reflection in AcornYtdlpExecutor.
-keep class com.yausername.** { *; }
-keepclassmembers class com.yausername.youtubedl_android.YoutubeDL {
    static ** INSTANCE;
    <fields>;
}
# ZipUtils (youtubedl_common) uses zip4j via reflection — R8 breaks initPython without these.
-keep class net.lingala.zip4j.** { *; }
-dontwarn net.lingala.zip4j.**

-keep class com.acorn.videodownloader.** { *; }
