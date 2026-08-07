# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# Mantém número de linha em stack traces nativas (útil pra debugar um
# eventual crash reportado por usuário), mas oculta o nome do arquivo fonte.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# O bridge JS-para-nativo do Capacitor já vem coberto pelas consumer rules
# do @capacitor/android (mergeadas automaticamente no build), mas mantém
# aqui como reforço caso algum plugin de terceiros dependa de reflection
# sem publicar suas próprias regras.
-keep public class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
}
