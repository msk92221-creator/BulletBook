package kr.co.bulletbook.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.List;

public class WidgetEventLayoutTest {
    private LocalDate day(String date){return LocalDate.parse(date);}
    private WidgetEventLayout.Event event(String id,String start,String end){
        return new WidgetEventLayout.Event(id,"밥먹기","#257763",day(start),day(end));
    }
    @Test public void sixteenThroughTwentyFiveIsThreeWeeklyBarsNotTenLabels() {
        List<WidgetEventLayout.Event> events=Arrays.asList(event("meal","2026-10-16","2026-10-25"));
        WidgetEventLayout.Segment first=WidgetEventLayout.week(events,day("2026-10-11")).get(0);
        assertEquals(5,first.start);assertEquals(6,first.end);
        assertFalse(first.continuesBefore);assertTrue(first.continuesAfter);
        WidgetEventLayout.Segment middle=WidgetEventLayout.week(events,day("2026-10-18")).get(0);
        assertEquals(0,middle.start);assertEquals(6,middle.end);
        assertTrue(middle.continuesBefore);assertTrue(middle.continuesAfter);
        WidgetEventLayout.Segment last=WidgetEventLayout.week(events,day("2026-10-25")).get(0);
        assertEquals(0,last.start);assertEquals(0,last.end);
        assertTrue(last.continuesBefore);assertFalse(last.continuesAfter);
        assertEquals("#257763",last.event.color);
    }
    @Test public void collisionsKeepTheirOwnRowsAndOverflowCountsEveryCoveredDay() {
        List<WidgetEventLayout.Event> events=Arrays.asList(event("a","2026-10-16","2026-10-25"),
            event("b","2026-10-19","2026-10-21"),event("c","2026-10-22","2026-10-24"));
        List<WidgetEventLayout.Segment> segments=WidgetEventLayout.week(events,day("2026-10-18"));
        assertEquals(0,segments.get(0).lane);assertEquals(1,segments.get(1).lane);assertEquals(1,segments.get(2).lane);
        assertArrayEquals(new int[]{0,1,1,1,1,1,1},WidgetEventLayout.overflow(segments,1));
    }
    @Test public void equalTitlesOnAdjacentDaysStaySeparate() {
        List<WidgetEventLayout.Segment> segments=WidgetEventLayout.week(Arrays.asList(
            event("a","2026-10-19","2026-10-19"),event("b","2026-10-20","2026-10-20")),day("2026-10-18"));
        assertEquals(2,segments.size());assertEquals(1,segments.get(0).start);assertEquals(2,segments.get(1).start);
    }
    @Test public void recurrenceStopIncludesLastOccurrenceTailAcrossYear() {
        List<WidgetEventLayout.Event> events=WidgetEventLayout.expand(event("a","2026-12-25","2026-12-28"),
            "weekly",day("2027-01-01"),day("2027-01-03"),day("2027-01-10"));
        assertEquals(1,events.size());assertEquals(day("2027-01-01"),events.get(0).start);
        assertEquals(day("2027-01-04"),events.get(0).end);
    }
    @Test public void dailyOccurrencesRemainDistinctEvenWhenPeriodsOverlap() {
        List<WidgetEventLayout.Event> events=WidgetEventLayout.expand(event("a","2026-10-16","2026-10-18"),
            "daily",day("2026-10-18"),day("2026-10-18"),day("2026-10-24"));
        assertEquals(3,events.size());
        List<WidgetEventLayout.Segment> segments=WidgetEventLayout.week(events,day("2026-10-18"));
        assertArrayEquals(new int[]{2,2,1,0,0,0,0},WidgetEventLayout.overflow(segments,1));
    }
    @Test public void monthlyAndLeapDatesSkipMissingDates() {
        assertTrue(WidgetEventLayout.expand(event("a","2026-01-31","2026-01-31"),"monthly",null,day("2026-02-01"),day("2026-02-28")).isEmpty());
        assertEquals(1,WidgetEventLayout.expand(event("a","2024-02-29","2024-02-29"),"yearly",null,day("2028-02-01"),day("2028-03-01")).size());
    }
    @Test public void clippedIntervalsNeverCollideWithinALane() {
        List<WidgetEventLayout.Event> events=new ArrayList<>();
        LocalDate first=day("2026-12-27");
        for(int i=0;i<50;i++)events.add(new WidgetEventLayout.Event("e"+i,"일정","#4555ce",first.plusDays(i%10-3),first.plusDays(i%10+2)));
        List<WidgetEventLayout.Segment> segments=WidgetEventLayout.week(events,first);
        for(int i=0;i<segments.size();i++) {
            WidgetEventLayout.Segment a=segments.get(i);
            assertTrue(a.start>=0&&a.end<=6&&a.start<=a.end);
            for(int j=i+1;j<segments.size();j++) {
                WidgetEventLayout.Segment b=segments.get(j);
                if(a.lane==b.lane)assertTrue(a.end<b.start||b.end<a.start);
            }
        }
    }
}
