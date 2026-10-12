package kr.co.bulletbook.app;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** Date-only layout, independent of Android so week clipping and collisions are testable. */
final class WidgetEventLayout {
    static final class Event {
        final String id, title, color;
        final LocalDate start, end;
        Event(String id, String title, String color, LocalDate start, LocalDate end) {
            this.id=id; this.title=title; this.color=color; this.start=start; this.end=end;
        }
    }
    static final class Segment {
        final Event event;
        final int start, end, lane;
        final boolean continuesBefore, continuesAfter;
        Segment(Event event, int start, int end, int lane, LocalDate week) {
            this.event=event; this.start=start; this.end=end; this.lane=lane;
            continuesBefore=event.start.isBefore(week);
            continuesAfter=event.end.isAfter(week.plusDays(6));
        }
    }
    static List<Event> expand(Event event, String repeat, LocalDate until, LocalDate from, LocalDate to) {
        List<Event> out=new ArrayList<>();
        long span=ChronoUnit.DAYS.between(event.start,event.end);
        if(span<0 || span>366)return out;
        if("none".equals(repeat)) {
            if(!event.start.isAfter(to)&&!event.end.isBefore(from))out.add(event);
            return out;
        }
        LocalDate first=from.minusDays(span);
        if(first.isBefore(event.start))first=event.start;
        LocalDate stop=until==null||until.isAfter(to)?to:until;
        for(LocalDate day=first;!day.isAfter(stop);day=day.plusDays(1)) {
            long diff=ChronoUnit.DAYS.between(event.start,day);
            boolean matches="daily".equals(repeat)||("weekly".equals(repeat)&&diff%7==0)
                ||("monthly".equals(repeat)&&day.getDayOfMonth()==event.start.getDayOfMonth())
                ||("yearly".equals(repeat)&&day.getMonth()==event.start.getMonth()&&day.getDayOfMonth()==event.start.getDayOfMonth());
            if(matches)out.add(new Event(event.id+":"+day,event.title,event.color,day,day.plusDays(span)));
        }
        return out;
    }
    static List<Segment> week(List<Event> events, LocalDate first) {
        List<Event> sorted=new ArrayList<>();
        for(Event e:events)if(!e.end.isBefore(first)&&!e.start.isAfter(first.plusDays(6)))sorted.add(e);
        // Keep longer periods above single-day entries and break ties by stable identity.
        sorted.sort(Comparator.comparing((Event e)->e.start)
            .thenComparing(e->e.end,Comparator.reverseOrder()).thenComparing(e->e.id));
        List<boolean[]> occupied=new ArrayList<>();
        List<Segment> result=new ArrayList<>();
        for(Event e:sorted) {
            int start=(int)Math.max(0,ChronoUnit.DAYS.between(first,e.start));
            int end=(int)Math.min(6,ChronoUnit.DAYS.between(first,e.end));
            int lane=0;
            while(lane<occupied.size()&&collides(occupied.get(lane),start,end))lane++;
            if(lane==occupied.size())occupied.add(new boolean[7]);
            for(int day=start;day<=end;day++)occupied.get(lane)[day]=true;
            result.add(new Segment(e,start,end,lane,first));
        }
        return result;
    }
    private static boolean collides(boolean[] row,int start,int end) {
        for(int day=start;day<=end;day++)if(row[day])return true;
        return false;
    }
    static int visibleLanes(int widgetHeight,float fontScale) {
        float scale=Math.max(1f,fontScale);
        return Math.max(0,Math.min(4,(int)(((widgetHeight-88)/6f-24*scale)/(12*scale))));
    }
    static int[] overflow(List<Segment> segments,int visibleLanes) {
        int[] counts=new int[7];
        for(Segment s:segments)if(s.lane>=visibleLanes)for(int day=s.start;day<=s.end;day++)counts[day]++;
        return counts;
    }
}
