# NEXUS HUB para Android (APK propia)

Este proyecto crea una aplicación Android independiente que muestra la versión publicada de NEXUS HUB dentro de Android WebView. No es una PWA, TWA ni un acceso directo de Chrome.

## Requisitos

- Android Studio estable.
- JDK 17 (Android Studio puede usar el JDK incluido).
- Android SDK Platform 36 y Build Tools instalados desde SDK Manager.
- Conexión a Internet para cargar NEXUS HUB.

## Abrir y generar la APK

1. Descarga este repositorio o abre la carpeta \`android-app\` desde Android Studio.
2. Espera a que termine la sincronización de Gradle.
3. Si Android Studio solicita instalar Android SDK Platform 36 o Build Tools, acepta.
4. En el menú **Build**, elige **Build Bundle(s) / APK(s) > Build APK(s)**.
5. La APK de prueba se genera en \`app/build/outputs/apk/debug/app-debug.apk\`.

Si Android Studio pregunta cómo configurar Gradle, selecciona la versión compatible indicada en los archivos del proyecto y deja que sincronice las dependencias.

## Detalles

- Identificador Android: \`com.mael.nexushub\`.
- Nombre mostrado: **NEXUS HUB**.
- La aplicación carga \`https://maelcarber-oss.github.io/maelcb.hub.github.io/\`.
- JavaScript y DOM Storage están habilitados porque la web los necesita.
- La app usa el almacenamiento de su propio WebView. **No comparte automáticamente el \`localStorage\` de Chrome ni el de la PWA instalada.**
- Para recuperar datos en la APK, inicia sesión con la misma cuenta NEXUS HUB cuando la sincronización en la nube esté comprobada. Antes de la primera prueba, conserva una copia exportada de tus datos.
- Los enlaces externos se abren en la aplicación correspondiente del teléfono.
- La APK todavía debe probarse en el Realme: inicio de sesión, importación JSON, enlaces, teclado, navegación atrás y funcionamiento con Family Link.

## Tiempo de Chrome y Family Link

Al ser una APK con su propio identificador de paquete, Android la presenta como una aplicación distinta de Chrome. Eso permite que Family Link pueda mostrarla y limitarla por separado, pero hay que comprobarlo en el dispositivo real. WebView sigue usando el componente WebView del sistema Android; no significa que no consuma recursos del motor Chromium.
