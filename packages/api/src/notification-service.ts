import { energyEvents, type MorningBriefingEvent, type ProductionEndedEvent } from './energy-events.js';
import type { PushService } from './push-service.js';

function formatHour(hour: number | null): string {
  if (hour == null) return '–';
  return `~${hour}:00`;
}

function formatKwh(kwh: number): string {
  return kwh.toFixed(1);
}

function formatCent(cent: number): string {
  return cent.toFixed(0);
}

export class NotificationService {
  constructor(private pushService: PushService) {
    energyEvents.on('pv:morning-briefing', (event) => this.handleMorningBriefing(event));
    energyEvents.on('pv:production-ended', (event) => this.handleProductionEnded(event));
    console.log('[notifications] Service started');
  }

  private handleMorningBriefing(event: MorningBriefingEvent): void {
    const { chargePlan, currentSoc } = event;

    const totalRevenue = chargePlan.totalRevenueFixedCent + chargePlan.totalRevenueMarketCent;
    const body = [
      `Prognose: ${formatKwh(chargePlan.slots.reduce((s, sl) => s + sl.forecastW * 0.25 / 1000, 0))} kWh`,
      `Einspeisung: ${formatKwh(chargePlan.totalFeedInKwh)} kWh`,
      `Akku: ${currentSoc.toFixed(0)}% → ${chargePlan.slots.at(-1)?.estimatedSoc.toFixed(0) ?? '–'}% (voll ${formatHour(chargePlan.estimatedFullHour)})`,
      `Erlös: ~${formatCent(totalRevenue)} ct`,
    ].join('\n');

    void this.pushService.sendNotification({
      title: 'Morgen-Briefing',
      body,
      url: '/scenario-decision',
      tag: 'morning-briefing',
    });
  }

  private handleProductionEnded(event: ProductionEndedEvent): void {
    const totalRevenue = event.revenueFixedCent + event.revenueMarketCent;
    const body = [
      `PV: ${formatKwh(event.totalYieldKwh)} kWh | Eingespeist: ${formatKwh(event.feedInKwh)} kWh`,
      `Akku: ${event.finalSoc.toFixed(0)}%`,
      `Erlös: ${formatCent(event.revenueFixedCent)} ct EEG + ${formatCent(event.revenueMarketCent)} ct Börse = ${formatCent(totalRevenue)} ct`,
    ].join('\n');

    void this.pushService.sendNotification({
      title: 'Tages-Zusammenfassung',
      body,
      url: '/',
      tag: 'evening-summary',
    });
  }
}
