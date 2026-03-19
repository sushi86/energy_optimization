import { energyEvents, type MorningBriefingEvent, type ProductionEndedEvent } from './energy-events.js';
import type { PushService } from './push-service.js';

function formatKwh(kwh: number): string {
  return kwh.toFixed(1);
}

export class NotificationService {
  constructor(private pushService: PushService) {
    energyEvents.on('pv:morning-briefing', (event) => this.handleMorningBriefing(event));
    energyEvents.on('pv:production-ended', (event) => this.handleProductionEnded(event));
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
}
