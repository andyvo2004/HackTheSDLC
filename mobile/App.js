import React, { useMemo, useState } from "react";
import { ActivityIndicator, Linking, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import { WebView } from "react-native-webview";

function resolveWebUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_WEB_URL;
  const fromConfig = Constants.expoConfig?.extra?.webAppUrl;
  return fromEnv || fromConfig || "http://localhost:5173";
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const webUrl = useMemo(() => resolveWebUrl(), []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      {hasError ? (
        <View style={styles.errorCard}>
          <Text style={styles.title}>Unable to load Quick Payment Pages</Text>
          <Text style={styles.subtitle}>
            Make sure the web app is running and reachable from your phone.
          </Text>
          <TouchableOpacity style={styles.button} onPress={() => setHasError(false)}>
            <Text style={styles.buttonText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(webUrl)}>
            <Text style={styles.linkText}>Open in browser</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <WebView
            source={{ uri: webUrl }}
            onLoadStart={() => {
              setLoading(true);
              setHasError(false);
            }}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setHasError(true);
            }}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            pullToRefreshEnabled
          />
          {loading && (
            <View style={styles.loader}>
              <ActivityIndicator size="small" color="#2f88ff" />
              <Text style={styles.loaderText}>Loading secure payment experience...</Text>
            </View>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#031b3b",
  },
  loader: {
    position: "absolute",
    top: 20,
    left: 20,
    right: 20,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 10,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  loaderText: {
    color: "#0c1f3e",
    fontWeight: "600",
  },
  errorCard: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
  },
  subtitle: {
    color: "#c6d8ff",
    lineHeight: 20,
  },
  button: {
    marginTop: 8,
    backgroundColor: "#0f63ff",
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  linkText: {
    color: "#75d7ff",
    textAlign: "center",
    marginTop: 8,
    fontWeight: "600",
  },
});
