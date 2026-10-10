package kr.co.bulletbook.app;
import static org.junit.Assert.*;
import org.junit.Test;
import java.time.LocalDate;
public class FamilyCalendarTest {
    private boolean occurs(String start,long span,String repeat,String stop,String day){
        return FamilyCalendarStore.occursOn(LocalDate.parse(start),span,repeat,LocalDate.parse(stop),LocalDate.parse(day));
    }
    @Test public void multiDayAndRepeatEndsAreInclusive(){
        assertTrue(occurs("2026-10-10",2,"none","2026-12-31","2026-10-12"));
        assertFalse(occurs("2026-10-10",2,"none","2026-12-31","2026-10-13"));
        assertTrue(occurs("2026-10-01",2,"weekly","2026-10-08","2026-10-10"));
        assertFalse(occurs("2026-10-01",2,"weekly","2026-10-08","2026-10-15"));
    }
    @Test public void monthAndLeapDayDoNotClamp(){
        assertFalse(occurs("2026-01-31",0,"monthly","2028-12-31","2026-02-28"));
        assertTrue(occurs("2026-01-31",0,"monthly","2028-12-31","2026-03-31"));
        assertFalse(occurs("2024-02-29",0,"yearly","2030-12-31","2026-02-28"));
        assertTrue(occurs("2024-02-29",0,"yearly","2030-12-31","2028-02-29"));
    }
}
