-- Fix the email pattern in the existing registration RPC without rewriting
-- the already-applied migration that introduced the function.
do $migration$
declare
    function_definition text;
    corrected_definition text;
begin
    select pg_get_functiondef(
        'private.register_for_event_v2(uuid,jsonb,jsonb,text,text)'::regprocedure
    )
    into function_definition;

    corrected_definition := replace(
        function_definition,
        $needle$\\.$needle$,
        $replacement$[.]$replacement$
    );

    if corrected_definition = function_definition then
        raise exception 'The expected registration email pattern was not found.';
    end if;

    execute corrected_definition;
end;
$migration$;
