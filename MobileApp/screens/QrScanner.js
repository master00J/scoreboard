import { useEffect } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StyleSheet } from 'react-native';
import { Button } from '../components/ui';
import { useI18n } from '../lib/i18n';

export function QrScanner({ onCode, onCancel }) {
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);
  if (!permission?.granted) {
    return <Button label={t('connection.settings')} variant="secondary" onPress={() => requestPermission()} />;
  }
  return <>
    <CameraView
      style={local.camera}
      facing="back"
      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={({ data }) => onCode(String(data))}
    />
    <Button label={t('common.cancel')} variant="secondary" onPress={onCancel} />
  </>;
}

const local = StyleSheet.create({
  camera: { height: 320, borderRadius: 18, overflow: 'hidden' },
});
