import React, { Component, ReactNode } from 'react';
import { View, Text, ScrollView, SafeAreaView, TouchableOpacity } from 'react-native';
import App from './App';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#7f1d1d' }}>
          <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
            <Text style={{ fontSize: 24, fontWeight: 'bold', color: 'white', marginBottom: 16 }}>
              Something went wrong
            </Text>
            <View style={{ backgroundColor: 'black', padding: 16, borderRadius: 8 }}>
              <Text style={{ color: '#ef4444', fontFamily: 'monospace', fontSize: 12 }}>
                {this.state.error?.toString()}
              </Text>
              <Text style={{ color: '#fca5a5', fontFamily: 'monospace', fontSize: 10, marginTop: 8 }}>
                {this.state.errorInfo?.componentStack}
              </Text>
            </View>
            <TouchableOpacity
              style={{ marginTop: 24, backgroundColor: 'white', padding: 12, borderRadius: 8, alignItems: 'center' }}
              onPress={() => this.setState({ hasError: false, error: null, errorInfo: null })}
            >
              <Text style={{ color: '#7f1d1d', fontWeight: 'bold' }}>Try Again</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

export default function ErrorCatcher() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
