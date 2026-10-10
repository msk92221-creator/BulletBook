(() => {
  'use strict';
  window.BulletBookFamilyHost = {
    create(options) {
      const dialog = document.createElement('dialog');
      dialog.className = 'family-calendar-dialog';
      dialog.setAttribute('aria-label', '패밀리팀룸 가족 달력');
      const frame = document.createElement('iframe');
      frame.title = '패밀리팀룸 가족 달력';
      frame.src = 'family-room/index.html';
      dialog.append(frame); document.body.append(dialog);
      let scope = '', days = {}, linked = new Set(), deleted = new Set(), pendingDate = '';
      let lastExport = '', exportGeneration = 0, bindingTimer = null, accountGeneration = 0, activeBookId = '', projectionSignature = '';
      let nativeSequence = 0;
      const post = message => frame.contentWindow?.postMessage({channel:'bulletbook-family-v1',...message},location.origin);
      const native = payload => window.BulletBookNative?.configureFamilyCalendar?.(
        `family-${Date.now()}-${++nativeSequence}`, JSON.stringify(payload));
      const refresh = async () => {
        if (!scope) return;
        const generation = ++exportGeneration, book = options.getBook();
        if(activeBookId && activeBookId!==book.id){days={};linked.clear();deleted.clear();projectionSignature='';}
        activeBookId=book.id;
        const exported = await options.exportEntries(() => generation === exportGeneration && options.getBook() === book);
        if (!exported || generation !== exportGeneration) return;
        const signature = JSON.stringify([book.id, scope, exported]);
        if (signature === lastExport) return;
        lastExport = signature;
        post({type:'book',bookId:book.id,scope,...exported,bindings:book.familyCalendarBindings?.[scope] || {}});
      };
      window.addEventListener('message', async event => {
        if (event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.channel !== 'bulletbook-family-v1') return;
        const message = event.data;
        if (message.type === 'close') { dialog.close(); return; }
        if (message.type === 'loaded') { if(pendingDate)post({type:'open-date',date:pendingDate}); return; }
        if (message.type === 'disconnected' || (message.type === 'account' && scope && scope.split(':')[0]!==message.uid)) {
          scope='';days={};linked.clear();deleted.clear();lastExport='';exportGeneration++;accountGeneration++;projectionSignature='';
          clearTimeout(bindingTimer);native({disconnected:true});options.changed();return;
        }
        if (message.type === 'ready') {
          const book = options.getBook(), account = ++accountGeneration;
          if (!await options.backup(book)) { post({type:'backup-error'});return; }
          if(account!==accountGeneration||options.getBook()!==book)return;
          if(scope!==message.scope){days={};linked.clear();deleted.clear();projectionSignature='';}
          scope=message.scope;lastExport='';void refresh();return;
        }
        if (message.type === 'projection' && message.scope === scope && message.bookId === options.getBook().id) {
          days=message.days||{}; linked=new Set(message.linkedSources||[]);
          deleted=new Set(Object.entries(message.bindings||{}).filter(([,value])=>value.deleted).map(([key])=>key));
          clearTimeout(bindingTimer);
          const bookId=message.bookId;
          bindingTimer=setTimeout(()=>{if(message.scope===scope&&bookId===options.getBook().id)options.bindings(message.scope,message.bindings);},750);
          const signature=JSON.stringify([days,message.linkedSources,message.bindings]);
          if(signature!==projectionSignature){projectionSignature=signature;options.changed();}return;
        }
        if (message.type === 'native-session' && scope && message.session.uid+':'+message.session.familyId === scope) native(message);
      });
      frame.addEventListener('load',()=>{if(pendingDate)post({type:'open-date',date:pendingDate});});
      dialog.addEventListener?.('close',()=>options.changed());
      return {
        open(date) { pendingDate=date; if(!dialog.open)dialog.showModal();post({type:'open-date',date}); },
        close() { if(dialog.open)dialog.close(); },
        isOpen:()=>dialog.open,
        isConnected:()=>!!scope,
        events(date) { return days[date] || []; },
        hides:sourceId=>linked.has(sourceId),
        deleted:sourceId=>deleted.has(sourceId),
        refresh,
        days:()=>days,
      };
    },
  };
})();
