import { energyEvents, type MorningBriefingEvent, type ProductionEndedEvent, type TemperatureHighEvent, type SwitchedToManualEvent, type ManualDischargeEvent, type AutoRestoredEvent, type WallboxChargingStartedEvent, type WallboxChargingStoppedEvent, type WallboxPhasesSwitchedEvent } from './energy-events.js';
import type { PushService } from './push-service.js';

function formatKwh(kwh: number): string {
  return kwh.toFixed(1);
}

export class NotificationService {
  constructor(private pushService: PushService) {
    energyEvents.on('pv:morning-briefing', (event) => this.handleMorningBriefing(event));
    energyEvents.on('pv:production-ended', (event) => this.handleProductionEnded(event));
    energyEvents.on('mppt:temperature-high', (event) => this.handleTemperatureHigh(event));
    energyEvents.on('controller:switched-to-manual', (event) => this.handleSwitchedToManual(event));
    energyEvents.on('controller:manual-discharge', (event) => this.handleManualDischarge(event));
    energyEvents.on('controller:auto-restored', (event) => this.handleAutoRestored(event));
    energyEvents.on('wallbox:charging-started', (event) => this.handleWallboxChargingStarted(event));
    energyEvents.on('wallbox:charging-stopped', (event) => this.handleWallboxChargingStopped(event));
    energyEvents.on('wallbox:phases-switched', (event) => this.handleWallboxPhasesSwitched(event));
    energyEvents.on('wallbox:vehicle-plugged', () => this.handleWallboxVehicle(true));
    energyEvents.on('wallbox:vehicle-unplugged', () => this.handleWallboxVehicle(false));
    console.log('[notifications] Service started');
  }

  private handleMorningBriefing(event: MorningBriefingEvent): void {
    const { chargePlan, currentSoc } = event;
    const totalPvKwh = chargePlan.slots.reduce((s, sl) => s + sl.forecastW * 0.25 / 1000, 0);

    void this.pushService.sendNotification({
      title: 'Morgen-Briefing',
      body: `☀️ ${formatKwh(totalPvKwh)} kWh · ➡️ ${formatKwh(chargePlan.totalFeedInKwh)} kWh · 🔋 ${currentSoc.toFixed(0)}%`,
      url: '/scenario-decision',
      tag: 'morning-briefing',
    });
  }

  private handleProductionEnded(event: ProductionEndedEvent): void {
    const eegEur = (event.revenueFixedCent / 100).toFixed(2);
    const boerseEur = (event.revenueMarketCent / 100).toFixed(2);

    void this.pushService.sendNotification({
      title: 'Tages-Zusammenfassung',
      body: `☀️ ${formatKwh(event.totalYieldKwh)} kWh · ➡️ ${formatKwh(event.feedInKwh)} kWh · EEG ${eegEur}€ · Börse ${boerseEur}€`,
      url: '/',
      tag: 'evening-summary',
    });
  }

  private handleTemperatureHigh(event: TemperatureHighEvent): void {
    void this.pushService.sendNotification({
      title: 'Temperaturwarnung',
      body: `🌡️ MPPT Laderegler bei ${event.temperatureC.toFixed(1)} °C`,
      url: '/',
      tag: 'temperature-high',
    });
  }

  private handleSwitchedToManual(event: SwitchedToManualEvent): void {
    const body = event.trigger === 'external'
      ? `⚠️ Auf Manuell gewechselt — externer Setpoint (${event.setpointW ?? '?'} W)`
      : `⚠️ Auf Manuell gewechselt — über die Web-Oberfläche`;

    void this.pushService.sendNotification({
      title: 'Manueller Modus',
      body,
      url: '/',
      tag: 'mode-manual',
    });
  }

  private handleManualDischarge(event: ManualDischargeEvent): void {
    void this.pushService.sendNotification({
      title: 'Manueller Modus',
      body: `🔋 Manueller Modus entlädt den Akku — SOC ${event.batterySoc.toFixed(0)} %, ${Math.abs(event.batteryPowerW).toFixed(0)} W`,
      url: '/',
      tag: 'manual-discharge',
    });
  }

  private handleAutoRestored(event: AutoRestoredEvent): void {
    void this.pushService.sendNotification({
      title: 'Zurück auf Automatik',
      body: `✅ Zurück auf Automatik — Akku bei ${event.batterySoc.toFixed(0)} % (Manuell-Schutz)`,
      url: '/',
      tag: 'auto-restored',
    });
  }

  private handleWallboxChargingStarted(event: WallboxChargingStartedEvent): void {
    void this.pushService.sendNotification({
      title: 'Wallbox',
      body: `🔌 Ladung gestartet — ${event.phases}-phasig mit ${event.currentA} A (Überschuss ${event.surplusW} W)`,
      url: '/',
      tag: 'wallbox-charging',
    });
  }

  private handleWallboxChargingStopped(event: WallboxChargingStoppedEvent): void {
    void this.pushService.sendNotification({
      title: 'Wallbox',
      body: `⏹️ Ladung gestoppt — Überschuss zu gering (${event.surplusW} W)`,
      url: '/',
      tag: 'wallbox-charging',
    });
  }

  private handleWallboxPhasesSwitched(event: WallboxPhasesSwitchedEvent): void {
    void this.pushService.sendNotification({
      title: 'Wallbox',
      body: `⚡ Von ${event.from}- auf ${event.to}-phasig umgeschaltet (Überschuss ${event.surplusW} W)`,
      url: '/',
      tag: 'wallbox-phases',
    });
  }

  private handleWallboxVehicle(plugged: boolean): void {
    void this.pushService.sendNotification({
      title: 'Wallbox',
      body: plugged ? '🚗 Fahrzeug angesteckt' : '🚗 Fahrzeug abgesteckt',
      url: '/',
      tag: 'wallbox-vehicle',
    });
  }
}
