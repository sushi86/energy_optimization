# Home-Assistant-Side Konfiguration für Energy-Control-Verschattung

Damit das Verschattungs-Modul mit HA reden kann, sind zwei Eingriffe in der HA-Instanz nötig.

## 1. MQTT Statestream aktivieren

In `configuration.yaml` von HA folgenden Block sicherstellen:

```yaml
mqtt_statestream:
  base_topic: homeassistant
  publish_attributes: true       # WICHTIG — sonst kommt 'current_position' nicht mit
  publish_timestamps: true
  include:
    domains:
      - sensor
      - cover
      - binary_sensor
```

Nach Änderung: HA neustarten.

## 2. MQTT Service-Bridge-Automation

In den Automationen anlegen (Settings → Automations & Scenes → "+", dann „YAML-Modus"):

```yaml
- alias: "Energy Control: MQTT Service Bridge"
  description: "Übersetzt Publishes auf energy_control/service/<domain>/<service> in HA-Service-Calls"
  trigger:
    platform: mqtt
    topic: "energy_control/service/+/+"
  action:
    service: "{{ trigger.topic.split('/')[2] }}.{{ trigger.topic.split('/')[3] }}"
    data: "{{ trigger.payload_json }}"
```

## 3. MQTT-User für die Energy-Control-API

Wenn noch nicht vorhanden, in HA's MQTT-Broker-Konfig (Mosquitto-Add-on o.ä.) einen User mit Pub/Sub-Rechten anlegen:
- Username: z.B. `energy_control`
- Password: stark wählen
- ACL: subscribe `homeassistant/#`, `energy_control/#`, publish `energy_control/#`

Dann in der `.env` der Energy-Control-API hinterlegen:

```
HA_MQTT_URL=mqtt://homeassistant.local:1883
HA_MQTT_USER=energy_control
HA_MQTT_PASSWORD=<Passwort>
```

## 4. Verifikation

Nach Konfiguration:

```bash
# Subscribe-Test (von einer beliebigen Maschine im Netz)
mosquitto_sub -h homeassistant.local -u energy_control -P <pw> -t 'homeassistant/cover/#' -v
```

Eine Cover-Bewegung in HA sollte sofort Topic-Updates auslösen.
