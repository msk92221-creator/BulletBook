package kr.co.bulletbook.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

public class CalendarWidgetProviderTest {

    @Test
    public void visibleMonthAlwaysUsesSixMondayFirstRows() {
        List<LocalDate> dates = CalendarWidgetProvider.visibleDates(YearMonth.of(2026, 8));

        assertEquals(42, dates.size());
        assertEquals(LocalDate.of(2026, 7, 27), dates.get(0));
        assertEquals(LocalDate.of(2026, 9, 6), dates.get(41));
    }

    @Test
    public void eventSummaryShowsTitlesAndRemainingCount() {
        CalendarWidgetProvider.DayCount count = new CalendarWidgetProvider.DayCount();
        count.open = 4;
        count.items.add("○ 첫 일정");
        count.items.add("○ 둘째 일정");
        count.items.add("○ 셋째 일정");

        assertEquals("○ 첫 일정\n○ 둘째 일정\n+2", CalendarWidgetProvider.eventSummary(count));
    }
}
